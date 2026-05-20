// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IInsuranceFund {
    event Deposit(address indexed from, uint256 amount, uint256 newBalance);
    event Withdraw(address indexed to, uint256 amount, uint256 newBalance);
    event OwnerUpdated(address indexed previous, address indexed current);

    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();

    /// @notice Top up the fund. Anyone may call.
    function deposit(uint256 amount) external;

    /// @notice Owner-only withdraw. In production owner is a timelocked multisig.
    function withdraw(address to, uint256 amount) external;

    /// @notice Total USDC held by the fund, derived from the live token balance.
    function balance() external view returns (uint256);
}
