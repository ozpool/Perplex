// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {SessionKey} from "../../src/SessionKey.sol";
import {ISessionKey} from "../../src/interfaces/ISessionKey.sol";

contract SessionKeyTest is Test {
    SessionKey internal sk;

    address internal owner = makeAddr("owner");
    address internal consumer = makeAddr("consumer");
    address internal trader = makeAddr("trader");
    address internal mallory = makeAddr("mallory");
    address internal sessionPub = makeAddr("sessionPub");

    function setUp() public {
        sk = new SessionKey(owner, consumer);
    }

    function test_constructorRevertsOnZero() public {
        vm.expectRevert(ISessionKey.ZeroAddress.selector);
        new SessionKey(address(0), consumer);
        vm.expectRevert(ISessionKey.ZeroAddress.selector);
        new SessionKey(owner, address(0));
    }

    function test_registerHappyPath() public {
        uint64 exp = uint64(block.timestamp + 1 hours);
        vm.prank(trader);
        vm.expectEmit(true, true, false, true);
        emit ISessionKey.SessionRegistered(trader, sessionPub, exp, 10_000e6);
        sk.register(sessionPub, exp, 10_000e6);

        ISessionKey.Session memory s = sk.session(sessionPub);
        assertEq(s.owner, trader);
        assertEq(s.expiresAt, exp);
        assertEq(s.maxNotionalUsdc, 10_000e6);
        assertEq(s.spentNotionalUsdc, 0);
        assertTrue(s.active);
        assertTrue(sk.isValid(sessionPub));
    }

    function test_registerRevertsOnZeroPub() public {
        vm.prank(trader);
        vm.expectRevert(ISessionKey.ZeroAddress.selector);
        sk.register(address(0), uint64(block.timestamp + 1), 1);
    }

    function test_registerRevertsOnPastExpiry() public {
        vm.prank(trader);
        vm.expectRevert(ISessionKey.Expired.selector);
        sk.register(sessionPub, uint64(block.timestamp), 1);
    }

    function test_registerRevertsOnDuplicate() public {
        vm.startPrank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 1_000e6);
        vm.expectRevert(ISessionKey.AlreadyRegistered.selector);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 1_000e6);
        vm.stopPrank();
    }

    function test_revokeByOwner() public {
        uint64 exp = uint64(block.timestamp + 1 hours);
        vm.prank(trader);
        sk.register(sessionPub, exp, 1_000e6);
        vm.prank(trader);
        vm.expectEmit(true, true, false, false);
        emit ISessionKey.SessionRevoked(trader, sessionPub);
        sk.revoke(sessionPub);
        assertFalse(sk.isValid(sessionPub));
    }

    function test_revokeRevertsForNonOwner() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 1_000e6);
        vm.prank(mallory);
        vm.expectRevert(ISessionKey.NotOwner.selector);
        sk.revoke(sessionPub);
    }

    function test_revokeRevertsWhenNotActive() public {
        vm.prank(trader);
        vm.expectRevert(ISessionKey.NotActive.selector);
        sk.revoke(sessionPub);
    }

    function test_consumeAccumulates() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 10_000e6);

        vm.prank(consumer);
        sk.consume(sessionPub, 3_000e6);
        vm.prank(consumer);
        vm.expectEmit(true, false, false, true);
        emit ISessionKey.NotionalConsumed(sessionPub, 4_000e6, 7_000e6);
        sk.consume(sessionPub, 4_000e6);

        ISessionKey.Session memory s = sk.session(sessionPub);
        assertEq(s.spentNotionalUsdc, 7_000e6);
    }

    function test_consumeRevertsOverCap() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 5_000e6);
        vm.prank(consumer);
        sk.consume(sessionPub, 4_000e6);
        vm.prank(consumer);
        vm.expectRevert(
            abi.encodeWithSelector(ISessionKey.CapExceeded.selector, uint128(6_000e6), uint128(5_000e6))
        );
        sk.consume(sessionPub, 2_000e6);
    }

    function test_consumeRevertsAfterExpiry() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 5_000e6);
        skip(1 hours + 1);
        vm.prank(consumer);
        vm.expectRevert(ISessionKey.Expired.selector);
        sk.consume(sessionPub, 1);
    }

    function test_consumeRevertsAfterRevoke() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 5_000e6);
        vm.prank(trader);
        sk.revoke(sessionPub);
        vm.prank(consumer);
        vm.expectRevert(ISessionKey.NotActive.selector);
        sk.consume(sessionPub, 1);
    }

    function test_consumeRevertsForUnauthorisedCaller() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 5_000e6);
        vm.prank(mallory);
        vm.expectRevert(ISessionKey.NotAuthorizedConsumer.selector);
        sk.consume(sessionPub, 1);
    }

    function test_isValidFalseAfterExpiry() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 5_000e6);
        skip(1 hours + 1);
        assertFalse(sk.isValid(sessionPub));
    }

    function test_isValidFalseAtCap() public {
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 1_000e6);
        vm.prank(consumer);
        sk.consume(sessionPub, 1_000e6);
        assertFalse(sk.isValid(sessionPub));
    }

    function test_setConsumerRotates() public {
        address rolled = makeAddr("rolled");
        vm.prank(owner);
        sk.setConsumer(rolled);
        assertEq(sk.consumer(), rolled);

        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 1_000e6);
        vm.prank(consumer);
        vm.expectRevert(ISessionKey.NotAuthorizedConsumer.selector);
        sk.consume(sessionPub, 1);
        vm.prank(rolled);
        sk.consume(sessionPub, 1);
    }

    function test_setConsumerRevertsForNonOwner() public {
        vm.prank(mallory);
        vm.expectRevert(ISessionKey.NotOwner.selector);
        sk.setConsumer(mallory);
    }

    function test_setConsumerRevertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(ISessionKey.ZeroAddress.selector);
        sk.setConsumer(address(0));
    }

    function test_transferOwnership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        sk.transferOwnership(next);
        assertEq(sk.owner(), next);
    }

    function test_signOneHundredOrdersWithinCap() public {
        // Acceptance: frontend can sign 100 orders without one wallet popup.
        vm.prank(trader);
        sk.register(sessionPub, uint64(block.timestamp + 1 hours), 100_000e6);
        for (uint256 i = 0; i < 100; ++i) {
            vm.prank(consumer);
            sk.consume(sessionPub, 1_000e6);
        }
        ISessionKey.Session memory s = sk.session(sessionPub);
        assertEq(s.spentNotionalUsdc, 100_000e6);
        // 101st must fail.
        vm.prank(consumer);
        vm.expectRevert();
        sk.consume(sessionPub, 1);
    }
}
