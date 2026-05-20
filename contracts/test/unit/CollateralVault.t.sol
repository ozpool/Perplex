// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CollateralVault} from "../../src/CollateralVault.sol";
import {ICollateralVault} from "../../src/interfaces/ICollateralVault.sol";
import {IPositionRegistry} from "../../src/interfaces/IPositionRegistry.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockRegistry is IPositionRegistry {
    bool public withdrawAlwaysSafe = true;
    mapping(address => uint256) public capPerUser;

    function setWithdrawAlwaysSafe(bool v) external {
        withdrawAlwaysSafe = v;
    }

    function setUserWithdrawCap(address user, uint256 cap) external {
        capPerUser[user] = cap;
    }

    function isWithdrawSafe(address user, uint256 amount) external view override returns (bool) {
        if (!withdrawAlwaysSafe) return false;
        if (capPerUser[user] != 0 && amount > capPerUser[user]) return false;
        return true;
    }

    // unused stubs — full PositionRegistry lives in src/PositionRegistry.sol
    function applyFill(address, bytes32, int256, uint256)
        external
        pure
        override
        returns (int256 realisedPnl, int256 fundingDelta)
    {
        return (0, 0);
    }

    function updateFunding(bytes32, int256) external override {}

    function unrealisedPnl(address, bytes32, uint256) external pure override returns (int256) {
        return 0;
    }

    function healthFactor(address, bytes32, uint256) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function liquidationPrice(address, bytes32) external pure override returns (uint256) {
        return 0;
    }

    function positions(address, bytes32) external pure override returns (Position memory p) {
        return p;
    }

    function markets(bytes32) external pure override returns (MarketParams memory m) {
        return m;
    }
}

contract CollateralVaultTest is Test {
    MockUSDC internal usdc;
    MockRegistry internal registry;
    CollateralVault internal vault;

    address internal settlement = makeAddr("settlement");
    address internal liquidation = makeAddr("liquidation");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    uint256 internal constant INITIAL_BAL = 10_000 * 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new MockRegistry();
        vault = new CollateralVault(IERC20(address(usdc)), registry, settlement, liquidation);

        usdc.mint(alice, INITIAL_BAL);
        usdc.mint(bob, INITIAL_BAL);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    // -- constructor ----------------------------------------------------------

    function test_constructorRevertsOnZeroUsdc() public {
        vm.expectRevert(bytes("usdc=0"));
        new CollateralVault(IERC20(address(0)), registry, settlement, liquidation);
    }

    function test_constructorRevertsOnZeroRegistry() public {
        vm.expectRevert(bytes("registry=0"));
        new CollateralVault(IERC20(address(usdc)), IPositionRegistry(address(0)), settlement, liquidation);
    }

    function test_constructorRevertsOnZeroSettlement() public {
        vm.expectRevert(bytes("settle=0"));
        new CollateralVault(IERC20(address(usdc)), registry, address(0), liquidation);
    }

    function test_constructorRevertsOnZeroLiquidation() public {
        vm.expectRevert(bytes("liq=0"));
        new CollateralVault(IERC20(address(usdc)), registry, settlement, address(0));
    }

    // -- deposit --------------------------------------------------------------

    function test_depositCreditsBalanceAndPullsTokens() public {
        uint256 amt = 1_000 * 1e6;
        vm.expectEmit(true, false, false, true);
        emit ICollateralVault.Deposit(alice, amt, amt);
        vm.prank(alice);
        vault.deposit(amt);

        assertEq(vault.balances(alice), amt, "alice balance");
        assertEq(vault.totalDeposits(), amt, "totalDeposits");
        assertEq(usdc.balanceOf(address(vault)), amt, "vault USDC");
        assertEq(usdc.balanceOf(alice), INITIAL_BAL - amt, "alice USDC");
    }

    function test_depositZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("amount=0"));
        vault.deposit(0);
    }

    function test_depositAccumulatesAcrossCalls() public {
        vm.startPrank(alice);
        vault.deposit(400 * 1e6);
        vault.deposit(600 * 1e6);
        vm.stopPrank();
        assertEq(vault.balances(alice), 1_000 * 1e6);
        assertEq(vault.totalDeposits(), 1_000 * 1e6);
    }

    // -- withdraw -------------------------------------------------------------

    function test_withdrawHappyPath() public {
        vm.startPrank(alice);
        vault.deposit(1_000 * 1e6);
        vm.expectEmit(true, false, false, true);
        emit ICollateralVault.Withdraw(alice, 400 * 1e6, 600 * 1e6);
        vault.withdraw(400 * 1e6);
        vm.stopPrank();

        assertEq(vault.balances(alice), 600 * 1e6);
        assertEq(vault.totalDeposits(), 600 * 1e6);
        assertEq(usdc.balanceOf(alice), INITIAL_BAL - 600 * 1e6);
    }

    function test_withdrawRevertsIfInsufficientBalance() public {
        vm.startPrank(alice);
        vault.deposit(100 * 1e6);
        vm.expectRevert(ICollateralVault.InsufficientBalance.selector);
        vault.withdraw(200 * 1e6);
        vm.stopPrank();
    }

    function test_withdrawRevertsIfBlockedByRegistry() public {
        vm.startPrank(alice);
        vault.deposit(1_000 * 1e6);
        vm.stopPrank();
        registry.setWithdrawAlwaysSafe(false);

        vm.prank(alice);
        vm.expectRevert(ICollateralVault.WithdrawalBlocked.selector);
        vault.withdraw(100 * 1e6);
    }

    function test_withdrawRespectsPerUserCap() public {
        vm.startPrank(alice);
        vault.deposit(1_000 * 1e6);
        vm.stopPrank();
        registry.setUserWithdrawCap(alice, 250 * 1e6);

        vm.prank(alice);
        vm.expectRevert(ICollateralVault.WithdrawalBlocked.selector);
        vault.withdraw(300 * 1e6);

        vm.prank(alice);
        vault.withdraw(200 * 1e6);
        assertEq(vault.balances(alice), 800 * 1e6);
    }

    // -- applySettlement ------------------------------------------------------

    function test_applySettlementCreditsFromSettlement() public {
        vm.prank(alice);
        vault.deposit(500 * 1e6);

        vm.prank(settlement);
        vault.applySettlement(alice, 100 * 1e6);

        assertEq(vault.balances(alice), 600 * 1e6);
    }

    function test_applySettlementDebitsFromLiquidation() public {
        vm.prank(alice);
        vault.deposit(500 * 1e6);

        vm.prank(liquidation);
        vault.applySettlement(alice, -100 * 1e6);

        assertEq(vault.balances(alice), 400 * 1e6);
    }

    function test_applySettlementZeroDeltaIsNoOp() public {
        vm.prank(alice);
        vault.deposit(500 * 1e6);
        vm.prank(settlement);
        vault.applySettlement(alice, 0);
        assertEq(vault.balances(alice), 500 * 1e6);
    }

    function test_applySettlementRevertsForUnauthorizedCaller() public {
        vm.prank(mallory);
        vm.expectRevert(ICollateralVault.UnauthorizedCaller.selector);
        vault.applySettlement(alice, 100 * 1e6);
    }

    function test_applySettlementDebitRevertsOnUnderflow() public {
        vm.prank(alice);
        vault.deposit(50 * 1e6);
        vm.prank(settlement);
        vm.expectRevert(ICollateralVault.InsufficientBalance.selector);
        vault.applySettlement(alice, -100 * 1e6);
    }

    /// @notice applySettlement is a balance-mutation primitive — it does NOT move USDC in or out.
    ///         A debit only reduces the user's accounting balance; the USDC stays in the vault
    ///         and is reallocated by the settlement publisher to the opposite counterparty.
    function test_applySettlementDoesNotMoveTokens() public {
        vm.prank(alice);
        vault.deposit(500 * 1e6);
        uint256 vaultBalBefore = usdc.balanceOf(address(vault));

        vm.prank(settlement);
        vault.applySettlement(alice, -50 * 1e6);

        assertEq(usdc.balanceOf(address(vault)), vaultBalBefore, "vault usdc unchanged");
        assertEq(vault.balances(alice), 450 * 1e6);
    }

    // -- fuzz -----------------------------------------------------------------

    function testFuzz_depositWithdrawRoundtrip(uint128 dep, uint128 wit) public {
        vm.assume(dep > 0);
        vm.assume(wit <= dep);
        usdc.mint(alice, dep);
        vm.startPrank(alice);
        vault.deposit(dep);
        vault.withdraw(wit);
        vm.stopPrank();

        assertEq(vault.balances(alice), uint256(dep) - uint256(wit));
        assertEq(vault.totalDeposits(), uint256(dep) - uint256(wit));
        assertEq(usdc.balanceOf(address(vault)), uint256(dep) - uint256(wit));
    }

    function testFuzz_applySettlementBalancePreserved(int128 delta) public {
        vm.assume(delta != 0);
        uint256 seed = 1_000 * 1e6;
        vm.prank(alice);
        vault.deposit(seed);

        int256 d = int256(delta);
        if (d > 0) {
            // d known positive, fits in uint256 trivially
            uint256 abs_ = uint256(d); // forge-lint: disable-line(unsafe-typecast)
            vm.prank(settlement);
            vault.applySettlement(alice, d);
            assertEq(vault.balances(alice), seed + abs_);
        } else {
            // int128 negates safely (int128.min cannot be reached because delta is int128
            // and -int128.min still fits in int256). For int128 inputs cast widened to int256, this is safe.
            uint256 absDelta = uint256(-d); // forge-lint: disable-line(unsafe-typecast)
            if (absDelta > seed) {
                vm.prank(settlement);
                vm.expectRevert(ICollateralVault.InsufficientBalance.selector);
                vault.applySettlement(alice, d);
            } else {
                vm.prank(settlement);
                vault.applySettlement(alice, d);
                assertEq(vault.balances(alice), seed - absDelta);
            }
        }
    }

    function testFuzz_unauthorizedCallerAlwaysReverts(address caller, int128 delta) public {
        vm.assume(caller != settlement && caller != liquidation);
        vm.prank(caller);
        vm.expectRevert(ICollateralVault.UnauthorizedCaller.selector);
        vault.applySettlement(alice, delta);
    }
}
