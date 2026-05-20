// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface ICollateralVault {
    event Deposit(address indexed user, uint256 amount, uint256 newBalance);
    event Withdraw(address indexed user, uint256 amount, uint256 newBalance);
    event SettlementDebit(address indexed user, uint256 amount);
    event SettlementCredit(address indexed user, uint256 amount);

    error WithdrawalBlocked();
    error UnauthorizedCaller();
    error InsufficientBalance();

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function applySettlement(address user, int256 delta) external;
    function balances(address user) external view returns (uint256);
    function totalDeposits() external view returns (uint256);
}
