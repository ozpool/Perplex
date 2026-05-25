// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IFillHook} from "./IFillHook.sol";

interface ISyntheticCounterparty is IFillHook {
    struct PendingWithdraw {
        uint256 amount;
        uint64 eta;
    }

    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event SettlementUpdated(address indexed previousSettlement, address indexed newSettlement);
    event CapUpdated(bytes32 indexed marketId, uint256 previousCap, uint256 newCap);
    event Deposited(address indexed from, uint256 amount, uint256 newCustody);
    event VaultDeposit(uint256 amount);
    event WithdrawQueued(uint256 amount, uint64 eta);
    event WithdrawCancelled(uint256 amount);
    event WithdrawExecuted(address indexed to, uint256 amount);
    event FillRecorded(
        bytes32 indexed marketId, int256 sizeDelta, uint256 priceX18, int256 newSize, int256 realisedPnl
    );

    error NotOwner();
    error NotSettlement();
    error ZeroAddress();
    error ZeroAmount();
    error CapExceeded(bytes32 marketId, uint256 cap, uint256 attempted);
    error WithdrawAlreadyQueued();
    error NoWithdrawQueued();
    error WithdrawNotReady(uint64 eta);
    error InsufficientCustody();

    function TIMELOCK() external view returns (uint64);
    function USDC() external view returns (address);
    function VAULT() external view returns (address);
    function settlement() external view returns (address);
    function owner() external view returns (address);

    function marketCap(bytes32 marketId) external view returns (uint256);
    function position(bytes32 marketId) external view returns (int256);
    function realisedPnl(bytes32 marketId) external view returns (int256);
    function pendingWithdraw() external view returns (uint256 amount, uint64 eta);

    function setCap(bytes32 marketId, uint256 cap) external;
    function setSettlement(address newSettlement) external;
    function transferOwnership(address newOwner) external;

    function deposit(uint256 amount) external;
    function depositToVault(uint256 amount) external;
    function queueWithdraw(uint256 amount) external;
    function cancelWithdraw() external;
    function executeWithdraw(address to) external;
}
