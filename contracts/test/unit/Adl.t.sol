// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LiquidationEngine} from "../../src/LiquidationEngine.sol";
import {InsuranceFund} from "../../src/InsuranceFund.sol";
import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {MockOracle} from "../../src/MockOracle.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {ILiquidationEngine} from "../../src/interfaces/ILiquidationEngine.sol";
import {IInsuranceFund} from "../../src/interfaces/IInsuranceFund.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";

contract AdlTest is Test {
    LiquidationEngine internal engine;
    InsuranceFund internal fund;
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;
    CollateralVault internal vault;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal settlement = makeAddr("settlement");
    address internal liquidator = makeAddr("liquidator");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant BTC = keccak256("btc-usd");

    function setUp() public {
        markets = new MarketRegistry(owner);
        oracle = new MockOracle(owner);
        registry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));
        usdc = new MockUSDC();
        fund = new InsuranceFund(IERC20(address(usdc)), owner);

        address futureEngine = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new CollateralVault(IERC20(address(usdc)), registry, settlement, futureEngine);
        engine = new LiquidationEngine(
            owner,
            IMarketRegistry(address(markets)),
            IPositionRegistry(address(registry)),
            IOracleAdapter(address(oracle)),
            ICollateralVault(address(vault)),
            IInsuranceFund(address(fund))
        );
        require(address(engine) == futureEngine, "engine address mismatch");

        vm.prank(owner);
        registry.setWiring(ICollateralVault(address(vault)), settlement, address(engine));

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
    }

    function _deposit(address user, uint256 amt) internal {
        usdc.mint(user, amt);
        vm.startPrank(user);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
    }

    function _openFill(address user, int256 size, uint256 price) internal {
        vm.prank(settlement);
        registry.applyFill(user, BTC, size, price);
    }

    // -- access + validation --------------------------------------------------

    function test_adlRevertsForNonOwner() public {
        address[] memory v = new address[](0);
        int256[] memory c = new int256[](0);
        vm.prank(mallory);
        vm.expectRevert(ILiquidationEngine.NotOwner.selector);
        engine.adl(BTC, v, c);
    }

    function test_adlRevertsOnLengthMismatch() public {
        address[] memory v = new address[](2);
        int256[] memory c = new int256[](1);
        vm.prank(owner);
        vm.expectRevert(ILiquidationEngine.LengthMismatch.selector);
        engine.adl(BTC, v, c);
    }

    function test_adlRevertsOnInactiveMarket() public {
        address[] memory v = new address[](0);
        int256[] memory c = new int256[](0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationEngine.MarketInactive.selector, keccak256("nope")));
        engine.adl(keccak256("nope"), v, c);
    }

    function test_adlRevertsOnNoPosition() public {
        address noOne = makeAddr("noOne");
        address[] memory v = new address[](1);
        int256[] memory c = new int256[](1);
        v[0] = noOne;
        c[0] = 1e17;
        vm.prank(owner);
        vm.expectRevert(ILiquidationEngine.NoPosition.selector);
        engine.adl(BTC, v, c);
    }

    function test_adlRevertsOnWrongSide() public {
        address alice = makeAddr("alice");
        _deposit(alice, 10_000 * 1e6);
        _openFill(alice, 1e18, 100_000e18); // long

        address[] memory v = new address[](1);
        int256[] memory c = new int256[](1);
        v[0] = alice;
        c[0] = 1e17; // same side as long — wrong
        vm.prank(owner);
        vm.expectRevert(ILiquidationEngine.WrongSide.selector);
        engine.adl(BTC, v, c);
    }

    function test_adlRevertsOnCloseTooLarge() public {
        address alice = makeAddr("alice");
        _deposit(alice, 10_000 * 1e6);
        _openFill(alice, 1e18, 100_000e18);
        vm.prank(owner);
        oracle.setPrice(BTC, 110_000e18); // long is profitable

        address[] memory v = new address[](1);
        int256[] memory c = new int256[](1);
        v[0] = alice;
        c[0] = -2e18; // more than position
        vm.prank(owner);
        vm.expectRevert(ILiquidationEngine.CloseExceedsPosition.selector);
        engine.adl(BTC, v, c);
    }

    function test_adlRevertsOnUnprofitableCounterparty() public {
        address alice = makeAddr("alice");
        _deposit(alice, 10_000 * 1e6);
        _openFill(alice, 1e18, 100_000e18);
        // Mark hasn't moved — long is at break-even, not profitable.
        address[] memory v = new address[](1);
        int256[] memory c = new int256[](1);
        v[0] = alice;
        c[0] = -1e17;
        vm.prank(owner);
        vm.expectRevert(ILiquidationEngine.NotProfitable.selector);
        engine.adl(BTC, v, c);
    }

    // -- happy path -----------------------------------------------------------

    function test_adlPartialCloseTransfersRealisedPnlToFund() public {
        address winner = makeAddr("winner");
        _deposit(winner, 10_000 * 1e6);
        _openFill(winner, 1e18, 100_000e18); // 1 BTC long @ 100k

        vm.prank(owner);
        oracle.setPrice(BTC, 110_000e18); // 10% up → 10k unrealised gain

        uint256 fundBefore = fund.balance();
        uint256 vaultUserBefore = vault.balances(winner);

        address[] memory v = new address[](1);
        int256[] memory c = new int256[](1);
        v[0] = winner;
        c[0] = -5e17; // close half: realised PnL = 0.5 * (110k - 100k) = 5_000 USDC

        vm.prank(owner);
        engine.adl(BTC, v, c);

        // Realised PnL credited then clawed back: net vault balance change == 0.
        assertEq(vault.balances(winner), vaultUserBefore, "winner balance net change");
        assertEq(fund.balance() - fundBefore, 5_000 * 1e6, "fund received realised PnL");

        // Position halved.
        IPositionRegistry.Position memory p = registry.positions(winner, BTC);
        assertEq(p.size, 5e17, "position not halved");
    }

    /// @notice Acceptance criterion: 100 winning shorts deleveraged proportionally to absorb a
    ///         shortfall equal to their combined realised PnL at the mark. Fund starts drained,
    ///         total fund growth == per-victim realised PnL aggregated over all 100.
    function test_adlSocialisesAcrossHundredProfitableShorts() public {
        // 100 short positions opened at $100k mark. Mark drops to $90k → 10% gain per short.
        // Each short has 0.1 BTC size, $10k notional, realised gain after closing fully = $1k.
        // Closing 10% of each: realised = $100. Total over 100 victims = $10k recovered.
        uint256 entry = 100_000e18;
        uint256 newMark = 90_000e18;
        uint256 perUserUSDC = 5_000 * 1e6;
        int256 size = -1e17; // 0.1 BTC short

        address[] memory shorts = new address[](100);
        for (uint256 i = 0; i < 100; ++i) {
            shorts[i] = address(uint160(0x2000 + i));
            _deposit(shorts[i], perUserUSDC);
            _openFill(shorts[i], size, entry);
        }

        vm.prank(owner);
        oracle.setPrice(BTC, newMark);

        // Fund drained at start (no deposits).
        assertEq(fund.balance(), 0);

        int256[] memory closeSizes = new int256[](100);
        for (uint256 i = 0; i < 100; ++i) {
            closeSizes[i] = -size / 10; // close 10% of the short, opposite sign = +1e16
        }

        vm.prank(owner);
        engine.adl(BTC, shorts, closeSizes);

        // Expected per-victim realised PnL = 0.01 BTC * (100k - 90k) = $100 USDC raw = 100e6.
        // Total = 100 * 100e6 = 10_000e6.
        uint256 expectedRecovery = 100 * 100 * 1e6;
        assertEq(fund.balance(), expectedRecovery, "total recovery == shortfall");

        // Each victim's vault balance unchanged (realised credit immediately clawed back).
        for (uint256 i = 0; i < 100; ++i) {
            assertEq(vault.balances(shorts[i]), perUserUSDC, "victim balance preserved");
            // Position reduced by 10%.
            IPositionRegistry.Position memory p = registry.positions(shorts[i], BTC);
            assertEq(p.size, size + closeSizes[i], "position size after close");
        }
    }

    function test_debitToExternalRevertsForRandomCaller() public {
        vm.prank(mallory);
        vm.expectRevert(ICollateralVault.UnauthorizedCaller.selector);
        vault.debitToExternal(makeAddr("anyone"), address(fund), 1);
    }
}
