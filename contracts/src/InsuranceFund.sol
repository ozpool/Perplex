// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IInsuranceFund} from "./interfaces/IInsuranceFund.sol";

/// @title InsuranceFund
/// @notice Backstop balance that absorbs liquidation residuals and pays out shortfalls.
///         USDC is custodied directly; the public `balance()` view reads the live token
///         balance so any pushed-in transfer (e.g. vault.safeTransfer during liquidation)
///         is reflected without separate accounting bookkeeping.
contract InsuranceFund is IInsuranceFund {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;
    address public owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _usdc, address _owner) {
        require(address(_usdc) != address(0), "usdc=0");
        if (_owner == address(0)) revert ZeroAddress();
        USDC = _usdc;
        owner = _owner;
        emit OwnerUpdated(address(0), _owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @inheritdoc IInsuranceFund
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount, balance());
    }

    /// @inheritdoc IInsuranceFund
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balance();
        if (amount > bal) revert InsufficientBalance();
        USDC.safeTransfer(to, amount);
        emit Withdraw(to, amount, balance());
    }

    /// @inheritdoc IInsuranceFund
    function balance() public view returns (uint256) {
        return USDC.balanceOf(address(this));
    }
}
