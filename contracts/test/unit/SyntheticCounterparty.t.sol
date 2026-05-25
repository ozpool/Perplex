// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {SyntheticCounterparty} from "../../src/SyntheticCounterparty.sol";
import {ISyntheticCounterparty} from "../../src/interfaces/ISyntheticCounterparty.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

contract MockVault is ICollateralVault {
    mapping(address => uint256) public override balances;
    uint256 public override totalDeposits;
    IERC20 public immutable USDC;

    constructor(IERC20 _usdc) {
        USDC = _usdc;
    }

    function deposit(uint256 amount) external override {
        USDC.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposit(msg.sender, amount, balances[msg.sender]);
    }

    function withdraw(uint256) external pure override {
        revert("not implemented");
    }

    function applySettlement(address, int256) external pure override {
        revert("not implemented");
    }

    function seizeForLiquidation(address, address, address, uint256)
        external
        pure
        override
        returns (uint256, uint256, uint256)
    {
        revert("not implemented");
    }

    function debitToExternal(address, address, uint256) external pure override returns (uint256) {
        revert("not implemented");
    }
}

    contract SyntheticCounterpartyTest is Test {
        SyntheticCounterparty internal cp;
        MockUSDC internal usdc;
        MockVault internal vault;

        address internal owner = makeAddr("owner");
        address internal settlement = makeAddr("settlement");
        address internal angel = makeAddr("angel");
        address internal treasury = makeAddr("treasury");

        bytes32 internal constant BTC = keccak256("btc-usd");
        bytes32 internal constant ETH = keccak256("eth-usd");

        function setUp() public {
            usdc = new MockUSDC();
            vault = new MockVault(IERC20(address(usdc)));
            cp = new SyntheticCounterparty(owner, settlement, address(usdc), address(vault));
        }

        // -- construction ---------------------------------------------------------

        function test_constructor_setsImmutables() public view {
            assertEq(cp.owner(), owner);
            assertEq(cp.settlement(), settlement);
            assertEq(cp.USDC(), address(usdc));
            assertEq(cp.VAULT(), address(vault));
            assertEq(cp.TIMELOCK(), 2 days);
        }

        function test_constructor_revertsOnZeroOwner() public {
            vm.expectRevert(ISyntheticCounterparty.ZeroAddress.selector);
            new SyntheticCounterparty(address(0), settlement, address(usdc), address(vault));
        }

        function test_constructor_revertsOnZeroUsdc() public {
            vm.expectRevert(ISyntheticCounterparty.ZeroAddress.selector);
            new SyntheticCounterparty(owner, settlement, address(0), address(vault));
        }

        function test_constructor_revertsOnZeroVault() public {
            vm.expectRevert(ISyntheticCounterparty.ZeroAddress.selector);
            new SyntheticCounterparty(owner, settlement, address(usdc), address(0));
        }

        function test_constructor_acceptsZeroSettlement() public {
            SyntheticCounterparty c = new SyntheticCounterparty(
                owner, address(0), address(usdc), address(vault)
            );
            assertEq(c.settlement(), address(0));
        }

        // -- admin ----------------------------------------------------------------

        function test_setCap_onlyOwner() public {
            vm.expectRevert(ISyntheticCounterparty.NotOwner.selector);
            cp.setCap(BTC, 10e18);
        }

        function test_setCap_writes() public {
            vm.prank(owner);
            cp.setCap(BTC, 10e18);
            assertEq(cp.marketCap(BTC), 10e18);
        }

        function test_setSettlement_zeroReverts() public {
            vm.prank(owner);
            vm.expectRevert(ISyntheticCounterparty.ZeroAddress.selector);
            cp.setSettlement(address(0));
        }

        function test_transferOwnership_flow() public {
            address newOwner = makeAddr("newOwner");
            vm.prank(owner);
            cp.transferOwnership(newOwner);
            assertEq(cp.owner(), newOwner);
        }

        // -- deposit + timelock withdraw -----------------------------------------

        function _fund(address who, uint256 amount) internal {
            usdc.mint(who, amount);
            vm.prank(who);
            usdc.approve(address(cp), amount);
            vm.prank(who);
            cp.deposit(amount);
        }

        function test_deposit_increasesCustody() public {
            _fund(angel, 1_000_000e6);
            assertEq(usdc.balanceOf(address(cp)), 1_000_000e6);
        }

        function test_deposit_zeroReverts() public {
            vm.expectRevert(ISyntheticCounterparty.ZeroAmount.selector);
            vm.prank(angel);
            cp.deposit(0);
        }

        function test_depositToVault_onlyOwner() public {
            _fund(angel, 100_000e6);
            vm.expectRevert(ISyntheticCounterparty.NotOwner.selector);
            cp.depositToVault(50_000e6);
        }

        function test_depositToVault_routesToVault() public {
            _fund(angel, 100_000e6);
            vm.prank(owner);
            cp.depositToVault(60_000e6);
            assertEq(vault.balances(address(cp)), 60_000e6);
            assertEq(usdc.balanceOf(address(cp)), 40_000e6);
        }

        function test_queueWithdraw_setsEta() public {
            _fund(angel, 100_000e6);
            vm.prank(owner);
            cp.queueWithdraw(20_000e6);
            (uint256 amount, uint64 eta) = cp.pendingWithdraw();
            assertEq(amount, 20_000e6);
            assertEq(eta, uint64(block.timestamp) + 2 days);
        }

        function test_queueWithdraw_doubleQueueReverts() public {
            _fund(angel, 100_000e6);
            vm.startPrank(owner);
            cp.queueWithdraw(10_000e6);
            vm.expectRevert(ISyntheticCounterparty.WithdrawAlreadyQueued.selector);
            cp.queueWithdraw(5_000e6);
            vm.stopPrank();
        }

        function test_executeWithdraw_beforeEta_reverts() public {
            _fund(angel, 100_000e6);
            vm.prank(owner);
            cp.queueWithdraw(10_000e6);
            (, uint64 eta) = cp.pendingWithdraw();
            vm.warp(eta - 1);
            vm.prank(owner);
            vm.expectRevert(abi.encodeWithSelector(ISyntheticCounterparty.WithdrawNotReady.selector, eta));
            cp.executeWithdraw(treasury);
        }

        function test_executeWithdraw_afterEta_pays() public {
            _fund(angel, 100_000e6);
            vm.prank(owner);
            cp.queueWithdraw(40_000e6);
            skip(2 days);
            vm.prank(owner);
            cp.executeWithdraw(treasury);
            assertEq(usdc.balanceOf(treasury), 40_000e6);
            assertEq(usdc.balanceOf(address(cp)), 60_000e6);
            (uint256 amount,) = cp.pendingWithdraw();
            assertEq(amount, 0);
        }

        function test_cancelWithdraw_clearsQueue() public {
            _fund(angel, 100_000e6);
            vm.startPrank(owner);
            cp.queueWithdraw(20_000e6);
            cp.cancelWithdraw();
            vm.stopPrank();
            (uint256 amount,) = cp.pendingWithdraw();
            assertEq(amount, 0);
        }

        function test_executeWithdraw_insufficientCustody_reverts() public {
            _fund(angel, 10_000e6);
            vm.prank(owner);
            cp.queueWithdraw(10_000e6);
            // Owner moves the custody into the vault before timelock elapses, leaving the
            // contract with zero raw USDC. The withdrawal must revert rather than
            // partially pay.
            vm.prank(owner);
            cp.depositToVault(10_000e6);
            skip(2 days);
            vm.prank(owner);
            vm.expectRevert(ISyntheticCounterparty.InsufficientCustody.selector);
            cp.executeWithdraw(treasury);
        }

        function test_executeWithdraw_zeroTo_reverts() public {
            _fund(angel, 10_000e6);
            vm.prank(owner);
            cp.queueWithdraw(1_000e6);
            skip(2 days);
            vm.prank(owner);
            vm.expectRevert(ISyntheticCounterparty.ZeroAddress.selector);
            cp.executeWithdraw(address(0));
        }

        // -- onFill: cap enforcement + PnL tracking ------------------------------

        function _setCap(bytes32 marketId, uint256 cap) internal {
            vm.prank(owner);
            cp.setCap(marketId, cap);
        }

        function test_onFill_nonSettlementReverts() public {
            _setCap(BTC, 5e18);
            vm.expectRevert(ISyntheticCounterparty.NotSettlement.selector);
            cp.onFill(address(cp), BTC, 1e18, 100_000e18, 0);
        }

        function test_onFill_otherUser_isNoop() public {
            _setCap(BTC, 5e18);
            address trader = makeAddr("trader");
            vm.prank(settlement);
            cp.onFill(trader, BTC, 1e18, 100_000e18, -50e18);
            assertEq(cp.position(BTC), 0);
            assertEq(cp.realisedPnl(BTC), 0);
        }

        function test_onFill_updatesPositionAndPnl() public {
            _setCap(BTC, 5e18);
            vm.prank(settlement);
            cp.onFill(address(cp), BTC, 2e18, 100_000e18, 0);
            vm.prank(settlement);
            cp.onFill(address(cp), BTC, 1e18, 100_000e18, 0);
            assertEq(cp.position(BTC), 3e18);

            // realised PnL accrues only when sizes reduce; emulate close by passing -3 and a
            // positive realised PnL.
            vm.prank(settlement);
            cp.onFill(address(cp), BTC, -3e18, 110_000e18, 30_000e18);
            assertEq(cp.position(BTC), 0);
            assertEq(cp.realisedPnl(BTC), 30_000e18);
        }

        function test_onFill_capExceeded_reverts() public {
            _setCap(BTC, 5e18);
            vm.prank(settlement);
            cp.onFill(address(cp), BTC, 4e18, 100_000e18, 0);
            vm.prank(settlement);
            vm.expectRevert(
                abi.encodeWithSelector(ISyntheticCounterparty.CapExceeded.selector, BTC, 5e18, 6e18)
            );
            cp.onFill(address(cp), BTC, 2e18, 100_000e18, 0);
        }

        function test_onFill_capAppliesToShortSide() public {
            _setCap(ETH, 10e18);
            vm.prank(settlement);
            vm.expectRevert(
                abi.encodeWithSelector(ISyntheticCounterparty.CapExceeded.selector, ETH, 10e18, 11e18)
            );
            cp.onFill(address(cp), ETH, -11e18, 4_000e18, 0);
        }

        function test_onFill_perMarketCapsAreIndependent() public {
            _setCap(BTC, 1e18);
            _setCap(ETH, 100e18);
            vm.prank(settlement);
            cp.onFill(address(cp), BTC, 1e18, 100_000e18, 0);
            vm.prank(settlement);
            cp.onFill(address(cp), ETH, 50e18, 4_000e18, 0);
            // BTC at cap, ETH still has headroom; another BTC long must fail.
            vm.prank(settlement);
            vm.expectRevert(
                abi.encodeWithSelector(ISyntheticCounterparty.CapExceeded.selector, BTC, 1e18, 2e18)
            );
            cp.onFill(address(cp), BTC, 1e18, 100_000e18, 0);
            // But ETH may still grow.
            vm.prank(settlement);
            cp.onFill(address(cp), ETH, 50e18, 4_000e18, 0);
            assertEq(cp.position(ETH), 100e18);
        }
    }
