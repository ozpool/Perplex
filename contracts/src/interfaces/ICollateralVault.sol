// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface ICollateralVault {
    event Deposit(address indexed user, uint256 amount, uint256 newBalance);
    event Withdraw(address indexed user, uint256 amount, uint256 newBalance);
    event SettlementDebit(address indexed user, uint256 amount);
    event SettlementCredit(address indexed user, uint256 amount);
    event LiquidationSeize(
        address indexed user,
        address indexed liquidator,
        address indexed fund,
        uint256 bonus,
        uint256 residual,
        uint256 shortfall
    );

    error WithdrawalBlocked();
    error UnauthorizedCaller();
    error InsufficientBalance();
    error ZeroAddress();

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function applySettlement(address user, int256 delta) external;

    /// @notice Drain the victim's vault balance and route it to liquidator + insurance fund.
    ///         Pays `bonusAmount` USDC to `liquidator` (capped at the user's balance), then
    ///         transfers the residual to `fund`. Returns the realised bonus, the realised
    ///         residual, and the shortfall (zero unless balance < bonusAmount).
    /// @dev Only callable by LIQUIDATION_ENGINE.
    function seizeForLiquidation(address user, address liquidator, address fund, uint256 bonusAmount)
        external
        returns (uint256 bonus, uint256 residual, uint256 shortfall);

    function balances(address user) external view returns (uint256);
    function totalDeposits() external view returns (uint256);
}
