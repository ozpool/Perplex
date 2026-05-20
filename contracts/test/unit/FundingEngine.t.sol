// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {FundingEngine} from "../../src/FundingEngine.sol";
import {PositionRegistry} from "../../src/PositionRegistry.sol";
import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {MockOracle} from "../../src/MockOracle.sol";
import {IFundingEngine} from "../../src/interfaces/IFundingEngine.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "../../src/interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";

contract FundingEngineTest is Test {
    FundingEngine internal engine;
    PositionRegistry internal registry;
    MarketRegistry internal markets;
    MockOracle internal oracle;

    address internal owner = makeAddr("owner");
    address internal submitter = makeAddr("submitter");
    address internal settlement = makeAddr("settlement");
    address internal liquidation = makeAddr("liquidation");
    address internal vault = makeAddr("vault");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant BTC = keccak256("btc-usd");
    bytes32 internal constant UNLISTED = keccak256("unlisted");

    function setUp() public {
        markets = new MarketRegistry(owner);
        oracle = new MockOracle(owner);
        registry =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));

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
        registry.setWiring(ICollateralVault(vault), settlement, liquidation);
        vm.stopPrank();

        engine = new FundingEngine(
            owner, IMarketRegistry(address(markets)), IPositionRegistry(address(registry)), submitter
        );

        vm.prank(owner);
        registry.setFundingEngine(address(engine));
    }

    function test_constructorRevertsOnZeroOwner() public {
        vm.expectRevert(IFundingEngine.ZeroAddress.selector);
        new FundingEngine(
            address(0), IMarketRegistry(address(markets)), IPositionRegistry(address(registry)), submitter
        );
    }

    function test_constructorRevertsOnZeroMarkets() public {
        vm.expectRevert(IFundingEngine.ZeroAddress.selector);
        new FundingEngine(owner, IMarketRegistry(address(0)), IPositionRegistry(address(registry)), submitter);
    }

    function test_constructorRevertsOnZeroPositions() public {
        vm.expectRevert(IFundingEngine.ZeroAddress.selector);
        new FundingEngine(owner, IMarketRegistry(address(markets)), IPositionRegistry(address(0)), submitter);
    }

    function test_constructorRevertsOnZeroSubmitter() public {
        vm.expectRevert(IFundingEngine.ZeroAddress.selector);
        new FundingEngine(
            owner, IMarketRegistry(address(markets)), IPositionRegistry(address(registry)), address(0)
        );
    }

    function test_setFundingEngineRevertsOnSecondCall() public {
        FundingEngine other = new FundingEngine(
            owner, IMarketRegistry(address(markets)), IPositionRegistry(address(registry)), submitter
        );
        vm.prank(owner);
        vm.expectRevert(PositionRegistry.FundingAlreadySet.selector);
        registry.setFundingEngine(address(other));
    }

    function test_setFundingEngineRevertsForNonOwner() public {
        // Fresh registry with no funding wired yet.
        PositionRegistry fresh =
            new PositionRegistry(owner, IMarketRegistry(address(markets)), IOracleAdapter(address(oracle)));
        vm.prank(mallory);
        vm.expectRevert(PositionRegistry.NotOwner.selector);
        fresh.setFundingEngine(address(engine));
    }

    function test_applyFundingRevertsForNonSubmitter() public {
        vm.prank(mallory);
        vm.expectRevert(IFundingEngine.NotSubmitter.selector);
        engine.applyFunding(BTC, 1e16);
    }

    function test_applyFundingRevertsOnInactiveMarket() public {
        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(IFundingEngine.MarketInactive.selector, UNLISTED));
        engine.applyFunding(UNLISTED, 1e16);
    }

    function test_applyFundingRevertsAboveCap() public {
        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(IFundingEngine.PremiumOutOfBounds.selector, int256(1e16 + 1)));
        engine.applyFunding(BTC, 1e16 + 1);
    }

    function test_applyFundingRevertsBelowCap() public {
        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(IFundingEngine.PremiumOutOfBounds.selector, int256(-1e16 - 1)));
        engine.applyFunding(BTC, -1e16 - 1);
    }

    function test_applyFundingFirstTickAdvancesIndex() public {
        vm.prank(submitter);
        vm.expectEmit(true, false, false, true);
        emit IFundingEngine.FundingApplied(BTC, 1e15, 0, 1e15, uint64(block.timestamp));
        engine.applyFunding(BTC, 1e15);

        assertEq(registry.marketIndexFunding(BTC), 1e15);
        assertEq(engine.lastFundingAt(BTC), block.timestamp);
    }

    function test_applyFundingMonotonicAcrossTicks() public {
        vm.prank(submitter);
        engine.applyFunding(BTC, 5e14);
        skip(8 hours);
        vm.prank(submitter);
        engine.applyFunding(BTC, 3e14);
        skip(8 hours);
        vm.prank(submitter);
        engine.applyFunding(BTC, -2e14);
        assertEq(registry.marketIndexFunding(BTC), 5e14 + 3e14 - 2e14);
    }

    function test_applyFundingRevertsTooSoon() public {
        vm.prank(submitter);
        engine.applyFunding(BTC, 1e15);
        skip(8 hours - 1);
        uint64 nextEligible = uint64(block.timestamp) + 1;
        vm.prank(submitter);
        vm.expectRevert(abi.encodeWithSelector(IFundingEngine.TooSoon.selector, nextEligible));
        engine.applyFunding(BTC, 1e15);
    }

    function test_applyFundingExactBoundaryAllowed() public {
        vm.prank(submitter);
        engine.applyFunding(BTC, 1e15);
        skip(8 hours);
        vm.prank(submitter);
        engine.applyFunding(BTC, 1e15);
        assertEq(registry.marketIndexFunding(BTC), 2e15);
    }

    function test_setSubmitterRotatesAuth() public {
        address rolled = makeAddr("rolled");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit IFundingEngine.SubmitterUpdated(submitter, rolled);
        engine.setSubmitter(rolled);
        assertEq(engine.submitter(), rolled);

        vm.prank(submitter);
        vm.expectRevert(IFundingEngine.NotSubmitter.selector);
        engine.applyFunding(BTC, 1e15);

        vm.prank(rolled);
        engine.applyFunding(BTC, 1e15);
    }

    function test_setSubmitterRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(IFundingEngine.NotOwner.selector);
        engine.setSubmitter(mallory);
    }

    function test_setSubmitterRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(IFundingEngine.ZeroAddress.selector);
        engine.setSubmitter(address(0));
    }

    function test_transferOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        engine.transferOwnership(next);
        assertEq(engine.owner(), next);
    }

    function test_transferOwnershipRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(IFundingEngine.NotOwner.selector);
        engine.transferOwnership(mallory);
    }

    function test_directUpdateFundingFromMalloryReverts() public {
        vm.prank(mallory);
        vm.expectRevert(PositionRegistry.NotFundingAuthority.selector);
        registry.updateFunding(BTC, 1e18);
    }

    function test_directUpdateFundingFromOwnerStillAllowedForBootstrap() public {
        vm.prank(owner);
        registry.updateFunding(BTC, 7e17);
        assertEq(registry.marketIndexFunding(BTC), 7e17);
    }

    function test_nextEligibleAtBeforeFirstTickIsZero() public view {
        assertEq(engine.nextEligibleAt(BTC), 0);
    }

    function test_nextEligibleAtAfterTickIsLastPlusInterval() public {
        vm.prank(submitter);
        engine.applyFunding(BTC, 1e15);
        assertEq(engine.nextEligibleAt(BTC), uint64(block.timestamp) + uint64(8 hours));
    }
}
