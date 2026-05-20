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

contract LiquidationEngineTest is Test {
    LiquidationEngine internal engine;
    InsuranceFund internal fund;
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;
    CollateralVault internal vault;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal settlement = makeAddr("settlement");
    address internal alice = makeAddr("alice");
    address internal liquidator = makeAddr("liquidator");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant BTC = keccak256("btc-usd");
    bytes32 internal constant UNLISTED = keccak256("nope");

    function setUp() public {
        markets = new MarketRegistry(owner);
        oracle = new MockOracle(owner);
        registry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));
        usdc = new MockUSDC();
        fund = new InsuranceFund(IERC20(address(usdc)), owner);

        // Stage engine address before deploying vault so the immutable LIQUIDATION_ENGINE check passes.
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
                imRatioBps: 500, // 5% IM
                mmRatioBps: 250, // 2.5% MM
                liqBonusBps: 100, // 1% bonus
                takerFeeBps: 5,
                makerRebateBps: -2,
                active: true
            })
        );
        oracle.setPrice(BTC, 100_000e18);
        vm.stopPrank();
    }

    // -- helpers --------------------------------------------------------------

    function _deposit(address user, uint256 amt) internal {
        usdc.mint(user, amt);
        vm.startPrank(user);
        usdc.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
    }

    /// @dev Open a long position for `user` at the current mark price using the settlement
    ///      address as proxy (registry restricts applyFill to settlement/liquidation).
    function _openLong(address user, bytes32 mkt, int256 size, uint256 price) internal {
        vm.prank(settlement);
        registry.applyFill(user, mkt, size, price);
    }

    // -- happy path -----------------------------------------------------------

    function test_liquidateRevertsForHealthyPosition() public {
        _deposit(alice, 10_000 * 1e6); // 10k USDC
        _openLong(alice, BTC, 1e17, 100_000e18); // 0.1 BTC long, $10k notional

        // HF = equity / (notional * MM). equity = 10k USDC. MM = 10k * 2.5% = 250. HF = 40.
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationEngine.Healthy.selector, 40 * 1e18));
        engine.liquidate(alice, BTC);
    }

    function test_liquidateRevertsForNoPosition() public {
        _deposit(alice, 1_000 * 1e6);
        // No position. healthFactor returns max, so the Healthy check triggers first.
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationEngine.Healthy.selector, type(uint256).max));
        engine.liquidate(alice, BTC);
    }

    function test_liquidateRevertsForInactiveMarket() public {
        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationEngine.MarketInactive.selector, UNLISTED));
        engine.liquidate(alice, UNLISTED);
    }

    function test_liquidateForceClosesAndDistributes() public {
        // Alice opens 1 BTC long @ $100k. Vault balance 3k USDC. Notional 100k. MM = 100k * 2.5% = 2.5k.
        // Equity at entry = 3k. HF = 3k / 2.5k = 1.2 (healthy).
        // Price drops to 97k. uPnL = (97k - 100k) * 1 = -3k. Equity = 3k - 3k = 0. HF = 0 (liquidatable).
        _deposit(alice, 3_000 * 1e6);
        _openLong(alice, BTC, 1e18, 100_000e18);

        vm.prank(owner);
        oracle.setPrice(BTC, 97_000e18);

        uint256 liqBefore = usdc.balanceOf(liquidator);
        uint256 fundBefore = fund.balance();

        vm.prank(liquidator);
        engine.liquidate(alice, BTC);

        // Position closed.
        IPositionRegistry.Position memory p = registry.positions(alice, BTC);
        assertEq(p.size, 0, "position not closed");
        // Vault balance drained.
        assertEq(vault.balances(alice), 0, "victim balance not drained");
        // Realised PnL on close: (97k - 100k) * 1 = -3k USD = -3000 USDC raw (1e6).
        // Vault settled -3k USDC, victim balance went 3k -> 0. Seize then drains 0.
        // No bonus, no residual, no shortfall (bonusUSDC = 100k * 1% / 1e12 = 1000 * 1e6, but balance is 0).
        // shortfall = 1000e6.
        assertEq(usdc.balanceOf(liquidator) - liqBefore, 0, "no bonus payable");
        assertEq(fund.balance() - fundBefore, 0, "no residual to fund");
    }

    function test_liquidatePaysBonusAndResidual() public {
        // Alice has 5k USDC, opens 1 BTC long @ 100k. After MM drop she'll be liquidatable but
        // with collateral remaining > bonus.
        _deposit(alice, 5_000 * 1e6);
        _openLong(alice, BTC, 1e18, 100_000e18);

        // Mark drops to 97.6k. uPnL = -2.4k. Equity = 5k - 2.4k = 2.6k. MM = 97.6k * 2.5% = 2.44k.
        // HF = 2.6k / 2.44k = 1.0655 — still healthy.
        // Push lower to 97k. uPnL = -3k. Equity = 2k. MM = 97k * 2.5% = 2.425k. HF = 0.825 (liquidatable).
        vm.prank(owner);
        oracle.setPrice(BTC, 97_000e18);

        uint256 liqBefore = usdc.balanceOf(liquidator);
        uint256 fundBefore = fund.balance();

        vm.prank(liquidator);
        engine.liquidate(alice, BTC);

        // After realised PnL of -3k: balance = 5k - 3k = 2k USDC raw.
        // Bonus = 1% of 97k = 970 USDC raw.
        // Residual = 2000 - 970 = 1030 USDC raw.
        assertEq(usdc.balanceOf(liquidator) - liqBefore, 970 * 1e6, "bonus");
        assertEq(fund.balance() - fundBefore, 1030 * 1e6, "residual");
        assertEq(vault.balances(alice), 0, "victim drained");
    }

    function test_liquidateOnlyDebitsVaultUserBalance() public {
        // Other user's balance must be untouched after a liquidation.
        address bob = makeAddr("bob");
        _deposit(alice, 5_000 * 1e6);
        _deposit(bob, 9_000 * 1e6);
        _openLong(alice, BTC, 1e18, 100_000e18);

        vm.prank(owner);
        oracle.setPrice(BTC, 97_000e18);
        vm.prank(liquidator);
        engine.liquidate(alice, BTC);

        assertEq(vault.balances(bob), 9_000 * 1e6, "bob balance changed");
    }

    /// @notice Sanity: liquidating again after the position is closed reverts with NoPosition
    ///         path (healthFactor returns max → Healthy check triggers first).
    function test_doubleLiquidateReverts() public {
        _deposit(alice, 5_000 * 1e6);
        _openLong(alice, BTC, 1e18, 100_000e18);
        vm.prank(owner);
        oracle.setPrice(BTC, 97_000e18);

        vm.prank(liquidator);
        engine.liquidate(alice, BTC);

        vm.prank(liquidator);
        vm.expectRevert(abi.encodeWithSelector(ILiquidationEngine.Healthy.selector, type(uint256).max));
        engine.liquidate(alice, BTC);
    }

    function test_seizeForLiquidationRevertsForRandomCaller() public {
        vm.prank(mallory);
        vm.expectRevert(ICollateralVault.UnauthorizedCaller.selector);
        vault.seizeForLiquidation(alice, mallory, address(fund), 1);
    }

    // -- 100-position crash ---------------------------------------------------

    /// @notice Synthetic crash scenario: 100 long traders fully collateralised at 5% IM, mark
    ///         drops 5% causing all to be liquidatable. Verify:
    ///           - each liquidation succeeds
    ///           - bonus paid to the liquidator each time
    ///           - residual collateral accumulates in the insurance fund
    ///           - the insurance fund never goes negative (it has no debit path at all)
    function test_crashLiquidatesHundredPositionsWithoutFundUnderflow() public {
        uint256 entryPrice = 100_000e18;
        uint256 newPrice = 97_000e18; // 3% drop, pushes all positions below MM
        uint256 perUserUSDC = 5_000 * 1e6;
        int256 size = 1e18;

        address[] memory victims = new address[](100);
        for (uint256 i = 0; i < 100; ++i) {
            victims[i] = address(uint160(0x1000 + i));
            _deposit(victims[i], perUserUSDC);
            _openLong(victims[i], BTC, size, entryPrice);
        }

        vm.prank(owner);
        oracle.setPrice(BTC, newPrice);

        uint256 fundStart = fund.balance();
        uint256 liqStart = usdc.balanceOf(liquidator);
        for (uint256 i = 0; i < 100; ++i) {
            vm.prank(liquidator);
            engine.liquidate(victims[i], BTC);
            assertGe(fund.balance(), fundStart, "fund went backwards");
        }

        // Each liquidation: PnL = -3k, residual balance = 2k USDC. Bonus = 1% of 97k = 970.
        // Residual = 2000 - 970 = 1030 per victim. Expected fund growth = 100 * 1030 = 103_000 USDC.
        uint256 expectedFundDelta = 100 * 1030 * 1e6;
        uint256 expectedBonusTotal = 100 * 970 * 1e6;
        assertEq(fund.balance() - fundStart, expectedFundDelta, "fund growth mismatch");
        assertEq(usdc.balanceOf(liquidator) - liqStart, expectedBonusTotal, "bonus total mismatch");
    }
}

contract InsuranceFundTest is Test {
    InsuranceFund internal fund;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal recipient = makeAddr("recipient");
    address internal mallory = makeAddr("mallory");

    function setUp() public {
        usdc = new MockUSDC();
        fund = new InsuranceFund(IERC20(address(usdc)), owner);
        usdc.mint(alice, 1_000_000 * 1e6);
        vm.prank(alice);
        usdc.approve(address(fund), type(uint256).max);
    }

    function test_constructorRevertsOnZeroOwner() public {
        vm.expectRevert(IInsuranceFund.ZeroAddress.selector);
        new InsuranceFund(IERC20(address(usdc)), address(0));
    }

    function test_constructorRevertsOnZeroUsdc() public {
        vm.expectRevert(bytes("usdc=0"));
        new InsuranceFund(IERC20(address(0)), owner);
    }

    function test_depositPullsUsdcAndUpdatesBalance() public {
        vm.prank(alice);
        fund.deposit(1_000 * 1e6);
        assertEq(fund.balance(), 1_000 * 1e6);
        assertEq(usdc.balanceOf(address(fund)), 1_000 * 1e6);
    }

    function test_depositRevertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("amount=0"));
        fund.deposit(0);
    }

    function test_withdrawHappyPath() public {
        vm.prank(alice);
        fund.deposit(1_000 * 1e6);

        vm.prank(owner);
        fund.withdraw(recipient, 400 * 1e6);

        assertEq(fund.balance(), 600 * 1e6);
        assertEq(usdc.balanceOf(recipient), 400 * 1e6);
    }

    function test_withdrawRevertsForNonOwner() public {
        vm.prank(alice);
        fund.deposit(1_000 * 1e6);
        vm.prank(mallory);
        vm.expectRevert(IInsuranceFund.NotOwner.selector);
        fund.withdraw(recipient, 1);
    }

    function test_withdrawRevertsOnInsufficient() public {
        vm.prank(alice);
        fund.deposit(100 * 1e6);
        vm.prank(owner);
        vm.expectRevert(IInsuranceFund.InsufficientBalance.selector);
        fund.withdraw(recipient, 200 * 1e6);
    }

    function test_withdrawRevertsOnZeroRecipient() public {
        vm.prank(alice);
        fund.deposit(100 * 1e6);
        vm.prank(owner);
        vm.expectRevert(IInsuranceFund.ZeroAddress.selector);
        fund.withdraw(address(0), 50 * 1e6);
    }

    /// @notice Direct USDC transfers are accepted (balance() reads the live token balance).
    ///         This is the path the vault's seizeForLiquidation uses.
    function test_directTransferIncreasesBalance() public {
        usdc.mint(alice, 500 * 1e6);
        vm.prank(alice);
        usdc.transfer(address(fund), 500 * 1e6);
        assertEq(fund.balance(), 500 * 1e6);
    }

    function test_transferOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        fund.transferOwnership(next);
        assertEq(fund.owner(), next);
    }

    function test_transferOwnershipRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(IInsuranceFund.NotOwner.selector);
        fund.transferOwnership(mallory);
    }
}
