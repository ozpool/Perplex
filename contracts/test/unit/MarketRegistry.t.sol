// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {MarketRegistry} from "../../src/MarketRegistry.sol";
import {IMarketRegistry} from "../../src/interfaces/IMarketRegistry.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";

contract MarketRegistryTest is Test {
    MarketRegistry internal markets;
    address internal owner = makeAddr("owner");
    address internal mallory = makeAddr("mallory");
    bytes32 internal constant BTC = keccak256("btc-usd");
    bytes32 internal constant ETH = keccak256("eth-usd");

    function setUp() public {
        markets = new MarketRegistry(owner);
    }

    function _validParams() internal pure returns (IPositionRegistry.MarketParams memory) {
        return IPositionRegistry.MarketParams({
            imRatioBps: 500,
            mmRatioBps: 250,
            liqBonusBps: 100,
            takerFeeBps: 5,
            makerRebateBps: -2,
            active: true
        });
    }

    function test_constructorSetsOwner() public view {
        assertEq(markets.owner(), owner);
    }

    function test_constructorRevertsOnZeroOwner() public {
        vm.expectRevert(IMarketRegistry.ZeroAddress.selector);
        new MarketRegistry(address(0));
    }

    function test_listMarketHappyPath() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit IMarketRegistry.MarketListed(BTC, p);
        markets.listMarket(BTC, p);

        assertTrue(markets.isMarketActive(BTC));
        IPositionRegistry.MarketParams memory got = markets.getParams(BTC);
        assertEq(got.imRatioBps, 500);
        assertEq(got.mmRatioBps, 250);

        bytes32[] memory listed = markets.listedMarkets();
        assertEq(listed.length, 1);
        assertEq(listed[0], BTC);
    }

    function test_listMarketRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(IMarketRegistry.NotOwner.selector);
        markets.listMarket(BTC, _validParams());
    }

    function test_listMarketRevertsOnDuplicate() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        vm.startPrank(owner);
        markets.listMarket(BTC, p);
        vm.expectRevert(abi.encodeWithSelector(IMarketRegistry.MarketAlreadyListed.selector, BTC));
        markets.listMarket(BTC, p);
        vm.stopPrank();
    }

    function test_listMarketRevertsOnZeroImRatio() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.imRatioBps = 0;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_listMarketRevertsWhenMmGteIm() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.mmRatioBps = p.imRatioBps;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_listMarketRevertsOnImAboveCap() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.imRatioBps = 5_001;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_listMarketRevertsOnLiqBonusAboveCap() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.liqBonusBps = 1_001;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_listMarketRevertsOnTakerFeeAboveCap() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.takerFeeBps = 101;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_listMarketRevertsOnMakerRebateOutOfBounds() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        p.makerRebateBps = -51;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);

        p.makerRebateBps = 51;
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.InvalidParams.selector);
        markets.listMarket(BTC, p);
    }

    function test_updateMarketHappyPath() public {
        IPositionRegistry.MarketParams memory p = _validParams();
        vm.startPrank(owner);
        markets.listMarket(BTC, p);
        p.takerFeeBps = 10;
        vm.expectEmit(true, false, false, true);
        emit IMarketRegistry.MarketUpdated(BTC, p);
        markets.updateMarket(BTC, p);
        vm.stopPrank();
        assertEq(markets.getParams(BTC).takerFeeBps, 10);
    }

    function test_updateMarketRevertsOnUnlisted() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(IMarketRegistry.MarketNotListed.selector, ETH));
        markets.updateMarket(ETH, _validParams());
    }

    function test_deactivateMarketHappyPath() public {
        vm.startPrank(owner);
        markets.listMarket(BTC, _validParams());
        vm.expectEmit(true, false, false, false);
        emit IMarketRegistry.MarketDeactivated(BTC);
        markets.deactivateMarket(BTC);
        vm.stopPrank();
        assertFalse(markets.isMarketActive(BTC));
    }

    function test_getParamsRevertsOnUnlisted() public {
        vm.expectRevert(abi.encodeWithSelector(IMarketRegistry.MarketNotListed.selector, ETH));
        markets.getParams(ETH);
    }

    function test_transferOwnership() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit IMarketRegistry.OwnerUpdated(owner, newOwner);
        markets.transferOwnership(newOwner);
        assertEq(markets.owner(), newOwner);
    }

    function test_transferOwnershipRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(IMarketRegistry.NotOwner.selector);
        markets.transferOwnership(mallory);
    }

    function test_transferOwnershipRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(IMarketRegistry.ZeroAddress.selector);
        markets.transferOwnership(address(0));
    }
}
