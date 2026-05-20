// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ICollateralVault} from "./interfaces/ICollateralVault.sol";
import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";

/// @title CollateralVault
/// @notice Custodies USDC collateral for every Perplex trader. Non-upgradable by design.
///         Withdrawals must leave enough free collateral to cover open positions.
///         Settlement and liquidation engines may debit or credit balances atomically per batch.
contract CollateralVault is ICollateralVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    IPositionRegistry public immutable REGISTRY;
    address public immutable SETTLEMENT_ENGINE;
    address public immutable LIQUIDATION_ENGINE;

    mapping(address user => uint256 balance) public balances;
    uint256 public totalDeposits;

    constructor(IERC20 _usdc, IPositionRegistry _registry, address _settlement, address _liquidation) {
        require(address(_usdc) != address(0), "usdc=0");
        require(address(_registry) != address(0), "registry=0");
        require(_settlement != address(0), "settle=0");
        require(_liquidation != address(0), "liq=0");
        USDC = _usdc;
        REGISTRY = _registry;
        SETTLEMENT_ENGINE = _settlement;
        LIQUIDATION_ENGINE = _liquidation;
    }

    /// @inheritdoc ICollateralVault
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposit(msg.sender, amount, balances[msg.sender]);
    }

    /// @inheritdoc ICollateralVault
    /// @dev Withdrawal is only allowed if the post-withdraw balance still covers all open positions.
    ///      Coverage check delegated to PositionRegistry.isWithdrawSafe (see docs/margin-math.md section 6).
    function withdraw(uint256 amount) external nonReentrant {
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        if (!REGISTRY.isWithdrawSafe(msg.sender, amount)) revert WithdrawalBlocked();
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        USDC.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount, balances[msg.sender]);
    }

    /// @inheritdoc ICollateralVault
    /// @dev Only callable by SettlementEngine and LiquidationEngine. Both are immutable addresses
    ///      set at construction and verified to be non-zero. A delta > 0 credits the user, a delta < 0
    ///      debits. Reverts if a debit would underflow the user balance.
    function applySettlement(address user, int256 delta) external {
        if (msg.sender != SETTLEMENT_ENGINE && msg.sender != LIQUIDATION_ENGINE) {
            revert UnauthorizedCaller();
        }
        if (delta == 0) return;
        if (delta > 0) {
            uint256 amt = SafeCast.toUint256(delta);
            balances[user] += amt;
            emit SettlementCredit(user, amt);
        } else {
            uint256 amt = SignedMath.abs(delta);
            if (balances[user] < amt) revert InsufficientBalance();
            balances[user] -= amt;
            emit SettlementDebit(user, amt);
        }
    }

    /// @inheritdoc ICollateralVault
    /// @dev Atomic liquidation distribution. Drains the victim's USDC balance, hands
    ///      `bonusAmount` (capped at balance) to the liquidator, and forwards the residual
    ///      to the insurance fund via direct safeTransfer. When the victim's balance is
    ///      below `bonusAmount` the returned `shortfall` is non-zero — callers covering it
    ///      from the fund itself are LiquidationEngine's responsibility, not the vault's.
    function seizeForLiquidation(address user, address liquidator, address fund, uint256 bonusAmount)
        external
        nonReentrant
        returns (uint256 bonus, uint256 residual, uint256 shortfall)
    {
        if (msg.sender != LIQUIDATION_ENGINE) revert UnauthorizedCaller();
        if (liquidator == address(0) || fund == address(0)) revert ZeroAddress();

        uint256 userBal = balances[user];
        balances[user] = 0;
        totalDeposits -= userBal;

        if (userBal >= bonusAmount) {
            bonus = bonusAmount;
            residual = userBal - bonusAmount;
            shortfall = 0;
        } else {
            bonus = userBal;
            residual = 0;
            shortfall = bonusAmount - userBal;
        }

        if (bonus > 0) USDC.safeTransfer(liquidator, bonus);
        if (residual > 0) USDC.safeTransfer(fund, residual);

        emit LiquidationSeize(user, liquidator, fund, bonus, residual, shortfall);
    }
}
