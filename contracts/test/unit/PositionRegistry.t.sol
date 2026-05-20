// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {MockOracle} from "../../src/MockOracle.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";

/// @notice Phase 1 tests focus on storage / access control. The applyFill VWAP math and
///         isWithdrawSafe formula land in Phase 2 with their own test suite.
contract PositionRegistryTest is Test {
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;

    address internal owner = makeAddr("owner");
    address internal settlement = makeAddr("settlement");
    address internal liquidation = makeAddr("liquidation");
    address internal vault = makeAddr("vault");
    address internal mallory = makeAddr("mallory");
    address internal alice = makeAddr("alice");
    bytes32 internal constant BTC = keccak256("btc-usd");

    function setUp() public {
        markets = new MarketRegistry(owner);
        oracle = new MockOracle(owner);
        registry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));

        // List BTC market so applyFill checks pass.
        vm.prank(owner);
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
    }

    function test_constructorRevertsOnZeroOwner() public {
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        new PositionRegistry(address(0), IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));
    }

    function test_constructorRevertsOnZeroMarkets() public {
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        new PositionRegistry(owner, IMarketRegistry(address(0)), IOracleAdapter(address(oracle)));
    }

    function test_constructorRevertsOnZeroOracle() public {
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(0)));
    }

    function test_setWiringHappyPath() public {
        vm.prank(owner);
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
        assertEq(address(registry.collateralVault()), vault);
        assertEq(registry.settlementEngine(), settlement);
        assertEq(registry.liquidationEngine(), liquidation);
    }

    function test_setWiringRevertsOnSecondCall() public {
        vm.startPrank(owner);
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
        vm.expectRevert(PositionRegistry.AlreadyWired.selector);
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
        vm.stopPrank();
    }

    function test_setWiringRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(PositionRegistry.NotOwner.selector);
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
    }

    function test_setWiringRevertsOnZeros() public {
        vm.startPrank(owner);
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        registry.setWiring(ICollateralVault(address(0)), settlement, liquidation);
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        registry.setWiring(ICollateralVault(vault), address(0), liquidation);
        vm.expectRevert(PositionRegistry.ZeroAddress.selector);
        registry.setWiring(ICollateralVault(vault), settlement, address(0));
        vm.stopPrank();
    }

    function test_applyFillRevertsForUnauthorized() public {
        _wire();
        vm.prank(mallory);
        vm.expectRevert(PositionRegistry.NotSettlement.selector);
        registry.applyFill(alice, BTC, 1e18, 100_000e18);
    }

    function test_applyFillRevertsOnInactiveMarket() public {
        _wire();
        vm.prank(owner);
        markets.deactivateMarket(BTC);
        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(PositionRegistry.MarketInactive.selector, BTC));
        registry.applyFill(alice, BTC, 1e18, 100_000e18);
    }

    function test_applyFillRevertsOnZeroUser() public {
        _wire();
        vm.prank(settlement);
        vm.expectRevert(bytes("user=0"));
        registry.applyFill(address(0), BTC, 1e18, 100_000e18);
    }

    function test_applyFillRevertsOnZeroDelta() public {
        _wire();
        vm.prank(settlement);
        vm.expectRevert(bytes("delta=0"));
        registry.applyFill(alice, BTC, 0, 100_000e18);
    }

    function test_applyFillRevertsOnZeroPrice() public {
        _wire();
        vm.prank(settlement);
        vm.expectRevert(bytes("price=0"));
        registry.applyFill(alice, BTC, 1e18, 0);
    }

    function test_applyFillSucceedsFromSettlement() public {
        _wire();
        vm.prank(settlement);
        vm.expectEmit(true, true, false, true);
        emit IPositionRegistry.FillApplied(alice, BTC, 1e18, 100_000e18, 0);
        registry.applyFill(alice, BTC, 1e18, 100_000e18);

        IPositionRegistry.Position memory p = registry.positions(alice, BTC);
        assertEq(p.lastUpdatedBlock, uint64(block.number));
    }

    function test_applyFillSucceedsFromLiquidation() public {
        _wire();
        vm.prank(liquidation);
        registry.applyFill(alice, BTC, -1e18, 100_000e18);
    }

    function test_isWithdrawSafeReturnsTrueForUntradedUser() public view {
        assertTrue(registry.isWithdrawSafe(alice, 1_000 * 1e6));
    }

    function test_isWithdrawSafeReturnsFalseAfterApplyFill() public {
        _wire();
        vm.prank(settlement);
        registry.applyFill(alice, BTC, 1e18, 100_000e18);
        // Phase 1 stub returns false for any user who has touched a market. Phase 2 implements
        // the real formula; the test will be updated then.
        assertFalse(registry.isWithdrawSafe(alice, 1));
    }

    function _wire() internal {
        vm.prank(owner);
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
    }
}
