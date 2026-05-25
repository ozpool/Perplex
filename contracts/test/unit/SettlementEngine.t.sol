// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SettlementEngine} from "../../src/SettlementEngine.sol";
import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {MockOracle} from "../../src/MockOracle.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {ISettlementEngine} from "../../src/interfaces/ISettlementEngine.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IFillHook} from "../../src/interfaces/IFillHook.sol";

contract RecordingHook is IFillHook {
    struct Call {
        address user;
        bytes32 marketId;
        int256 sizeDelta;
        uint256 priceX18;
        int256 realisedPnl;
    }

    Call[] public calls;

    function count() external view returns (uint256) {
        return calls.length;
    }

    function onFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18, int256 realisedPnl)
        external
        override
    {
        calls.push(Call(user, marketId, sizeDelta, priceX18, realisedPnl));
    }
}

contract RevertingHook is IFillHook {
    error HookBlocked();

    function onFill(address, bytes32, int256, uint256, int256) external pure override {
        revert HookBlocked();
    }
}

contract SettlementEngineTest is Test {
    SettlementEngine internal engine;
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;
    CollateralVault internal vault;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    uint256 internal operatorPk = 0xA11CE; // deterministic operator key
    address internal operator;
    address internal liquidation = makeAddr("liquidation");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant BTC = keccak256("btc-usd");

    function setUp() public {
        operator = vm.addr(operatorPk);

        markets = new MarketRegistry(owner);
        oracle = new MockOracle(owner);
        registry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));
        usdc = new MockUSDC();

        // Engine address is needed for vault construction; we deploy a placeholder vault first,
        // then the real engine, then point everything correctly via setWiring on the registry.
        // In Deploy.s.sol we use CREATE2 / staged ordering; here we use the simpler path:
        // deploy engine with vault placeholder set later.
        // For unit tests we deploy vault and engine pointing at each other.
        // Compute future engine address before deploying vault.
        address futureEngine = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new CollateralVault(IERC20(address(usdc)), registry, futureEngine, liquidation);
        engine = new SettlementEngine(owner, operator, registry, vault);
        require(address(engine) == futureEngine, "engine address mismatch");

        vm.prank(owner);
        registry.setWiring(ICollateralVault(address(vault)), address(engine), liquidation);

        // List BTC + seed price.
        vm.startPrank(owner);
        markets.listMarket(
            BTC,
            IPositionRegistry.MarketParams({
                imRatioBps: 500,
                mmRatioBps: 250,
                liqBonusBps: 100,
                takerFeeBps: 5,
                makerRebateBps: -2,
                active: true
            })
        );
        oracle.setPrice(BTC, 100_000e18);
        vm.stopPrank();

        // Fund alice and bob with 50k USDC vault balance each.
        _deposit(alice, 50_000 * 1e6);
        _deposit(bob, 50_000 * 1e6);
    }

    // -- constructor ----------------------------------------------------------

    function test_constructorRevertsOnZeroOwner() public {
        vm.expectRevert(ISettlementEngine.ZeroAddress.selector);
        new SettlementEngine(address(0), operator, registry, vault);
    }

    function test_constructorRevertsOnZeroOperator() public {
        vm.expectRevert(ISettlementEngine.ZeroAddress.selector);
        new SettlementEngine(owner, address(0), registry, vault);
    }

    function test_constructorRevertsOnZeroRegistry() public {
        vm.expectRevert(ISettlementEngine.ZeroAddress.selector);
        new SettlementEngine(owner, operator, IPositionRegistry(address(0)), vault);
    }

    function test_constructorRevertsOnZeroVault() public {
        vm.expectRevert(ISettlementEngine.ZeroAddress.selector);
        new SettlementEngine(owner, operator, registry, ICollateralVault(address(0)));
    }

    // -- batch validation ----------------------------------------------------

    function test_applyBatchRevertsOnEmpty() public {
        ISettlementEngine.Fill[] memory empty;
        vm.expectRevert(ISettlementEngine.EmptyBatch.selector);
        engine.applyBatch(empty, 1, uint64(block.timestamp + 1), hex"");
    }

    function test_applyBatchRevertsOnExpiredDeadline() public {
        ISettlementEngine.Fill[] memory fills = _onePair();
        vm.warp(1_000);
        vm.expectRevert(ISettlementEngine.BatchExpired.selector);
        engine.applyBatch(fills, 1, uint64(500), hex"");
    }

    function test_applyBatchRevertsOnBadSignature() public {
        ISettlementEngine.Fill[] memory fills = _onePair();
        bytes memory sig = _signBatch(0xBADBEEF, fills, 1, uint64(block.timestamp + 100));
        vm.expectRevert(ISettlementEngine.BadSignature.selector);
        engine.applyBatch(fills, 1, uint64(block.timestamp + 100), sig);
    }

    function test_applyBatchRevertsOnReplayedNonce() public {
        ISettlementEngine.Fill[] memory fills = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        bytes memory sig = _signBatch(operatorPk, fills, 1, deadline);
        engine.applyBatch(fills, 1, deadline, sig);

        vm.expectRevert(abi.encodeWithSelector(ISettlementEngine.NonceUsed.selector, uint256(1)));
        engine.applyBatch(fills, 1, deadline, sig);
    }

    // -- happy path ----------------------------------------------------------

    /// @notice Alice buys 0.1 BTC at 100k, Bob sells 0.1 BTC at 100k. Equal and opposite.
    ///         Both positions open at entry 100k. No realised PnL. Both balances unchanged
    ///         except for the (zero) fee in this test.
    function test_applyBatchOpensPairedPositions() public {
        ISettlementEngine.Fill[] memory fills = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        bytes memory sig = _signBatch(operatorPk, fills, 1, deadline);

        uint256 aliceVaultBefore = vault.balances(alice);
        uint256 bobVaultBefore = vault.balances(bob);

        engine.applyBatch(fills, 1, deadline, sig);

        IPositionRegistry.Position memory pa = registry.positions(alice, BTC);
        IPositionRegistry.Position memory pb = registry.positions(bob, BTC);
        assertEq(pa.size, 0.1e18, "alice long 0.1");
        assertEq(pb.size, -0.1e18, "bob short 0.1");
        assertEq(pa.entryPriceX18, 100_000e18);
        assertEq(pb.entryPriceX18, 100_000e18);

        // Zero-fee paired fills: vault balances unchanged.
        assertEq(vault.balances(alice), aliceVaultBefore);
        assertEq(vault.balances(bob), bobVaultBefore);
        assertTrue(engine.nonceUsed(1));
    }

    /// @notice Same fill with a 5 bps taker fee on Alice (1e18 * 100k * 0.0005 = 50e18 = 50 USDC).
    ///         Alice loses 50 USDC; Bob receives 25 USDC maker rebate (2 bps -> 20 USDC for 0.1 BTC).
    function test_applyBatchAppliesFees() public {
        ISettlementEngine.Fill[] memory fills = new ISettlementEngine.Fill[](2);
        // taker fee for alice: -(notional * 5 bps) = -(10_000e18 * 5/10000) = -5e18
        fills[0] = ISettlementEngine.Fill({
            user: alice, marketId: BTC, sizeDelta: 0.1e18, priceX18: 100_000e18, fee: -5e18
        });
        // maker rebate for bob: +(10_000e18 * 2/10000) = +2e18
        fills[1] = ISettlementEngine.Fill({
            user: bob, marketId: BTC, sizeDelta: -0.1e18, priceX18: 100_000e18, fee: 2e18
        });
        uint64 deadline = uint64(block.timestamp + 100);
        bytes memory sig = _signBatch(operatorPk, fills, 1, deadline);

        uint256 aliceBefore = vault.balances(alice);
        uint256 bobBefore = vault.balances(bob);
        engine.applyBatch(fills, 1, deadline, sig);

        assertEq(vault.balances(alice), aliceBefore - 5 * 1e6, "alice charged 5 USDC taker fee");
        assertEq(vault.balances(bob), bobBefore + 2 * 1e6, "bob credited 2 USDC maker rebate");
    }

    /// @notice Mid-batch revert (e.g. inactive market) reverts the entire batch.
    function test_applyBatchAtomicOnFailure() public {
        // Deactivate market between deposits and batch.
        vm.prank(owner);
        markets.deactivateMarket(BTC);

        ISettlementEngine.Fill[] memory fills = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        bytes memory sig = _signBatch(operatorPk, fills, 1, deadline);

        vm.expectRevert(); // PositionRegistry.MarketInactive(BTC)
        engine.applyBatch(fills, 1, deadline, sig);

        // EVM rolled back the entire tx including the nonce write, so the nonce is free for
        // re-submission once the underlying condition (e.g. market reactivated) is fixed.
        assertFalse(engine.nonceUsed(1), "nonce free after revert (atomic rollback)");
        IPositionRegistry.Position memory pa = registry.positions(alice, BTC);
        assertEq(pa.size, 0, "alice position untouched");
    }

    // -- realised PnL routing ------------------------------------------------

    /// @notice Alice opens long at 100k, then closes at 102k. Bob takes the other side both times.
    ///         Alice realises +200 USDC; Bob realises -200 USDC. Vault balances reflect.
    function test_applyBatchRealisesProfitsOnClose() public {
        // Batch 1: open
        ISettlementEngine.Fill[] memory open = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        engine.applyBatch(open, 1, deadline, _signBatch(operatorPk, open, 1, deadline));

        // Batch 2: close at higher price
        ISettlementEngine.Fill[] memory close_ = new ISettlementEngine.Fill[](2);
        close_[0] = ISettlementEngine.Fill({
            user: alice, marketId: BTC, sizeDelta: -0.1e18, priceX18: 102_000e18, fee: 0
        });
        close_[1] = ISettlementEngine.Fill({
            user: bob, marketId: BTC, sizeDelta: 0.1e18, priceX18: 102_000e18, fee: 0
        });
        uint256 aliceBefore = vault.balances(alice);
        uint256 bobBefore = vault.balances(bob);
        engine.applyBatch(close_, 2, deadline, _signBatch(operatorPk, close_, 2, deadline));

        assertEq(vault.balances(alice), aliceBefore + 200 * 1e6, "alice +200 USDC profit");
        assertEq(vault.balances(bob), bobBefore - 200 * 1e6, "bob -200 USDC loss");
    }

    // -- admin ---------------------------------------------------------------

    function test_setOperator() public {
        address newOp = makeAddr("newOp");
        vm.prank(owner);
        engine.setOperator(newOp);
        assertEq(engine.operator(), newOp);
    }

    function test_setOperatorRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(ISettlementEngine.NotOwner.selector);
        engine.setOperator(mallory);
    }

    function test_setFillHook_onlyOwner() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(mallory);
        vm.expectRevert(ISettlementEngine.NotOwner.selector);
        engine.setFillHook(address(hook));
    }

    function test_setFillHook_writes() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(owner);
        engine.setFillHook(address(hook));
        assertEq(engine.fillHook(), address(hook));
    }

    function test_applyBatch_invokesFillHookPerFill() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(owner);
        engine.setFillHook(address(hook));

        ISettlementEngine.Fill[] memory fills = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        engine.applyBatch(fills, 99, deadline, _signBatch(operatorPk, fills, 99, deadline));

        assertEq(hook.count(), fills.length, "hook called per fill");
        (address u0, bytes32 m0, int256 sd0,,) = hook.calls(0);
        assertEq(u0, alice);
        assertEq(m0, BTC);
        assertEq(sd0, int256(0.1e18));
    }

    function test_applyBatch_hookRevertAbortsBatch() public {
        RevertingHook hook = new RevertingHook();
        vm.prank(owner);
        engine.setFillHook(address(hook));

        ISettlementEngine.Fill[] memory fills = _onePair();
        uint64 deadline = uint64(block.timestamp + 100);
        bytes memory sig = _signBatch(operatorPk, fills, 100, deadline);
        vm.expectRevert(RevertingHook.HookBlocked.selector);
        engine.applyBatch(fills, 100, deadline, sig);
    }

    // -- helpers -------------------------------------------------------------

    function _deposit(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _onePair() internal view returns (ISettlementEngine.Fill[] memory fills) {
        fills = new ISettlementEngine.Fill[](2);
        fills[0] = ISettlementEngine.Fill({
            user: alice, marketId: BTC, sizeDelta: 0.1e18, priceX18: 100_000e18, fee: 0
        });
        fills[1] = ISettlementEngine.Fill({
            user: bob, marketId: BTC, sizeDelta: -0.1e18, priceX18: 100_000e18, fee: 0
        });
    }

    function _signBatch(uint256 pk, ISettlementEngine.Fill[] memory fills, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32[] memory hashes = new bytes32[](fills.length);
        for (uint256 i = 0; i < fills.length; ++i) {
            ISettlementEngine.Fill memory f = fills[i];
            hashes[i] = keccak256(
                abi.encode(engine.FILL_TYPEHASH(), f.user, f.marketId, f.sizeDelta, f.priceX18, f.fee)
            );
        }
        bytes32 fillsHash = keccak256(abi.encodePacked(hashes));
        bytes32 structHash = keccak256(abi.encode(engine.BATCH_TYPEHASH(), nonce, deadline, fillsHash));
        bytes32 domain = engine.DOMAIN_SEPARATOR();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
