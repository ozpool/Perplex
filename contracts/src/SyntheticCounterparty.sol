// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import {ICollateralVault} from "./interfaces/ICollateralVault.sol";
import {IFillHook} from "./interfaces/IFillHook.sol";
import {ISyntheticCounterparty} from "./interfaces/ISyntheticCounterparty.sol";

/// @title SyntheticCounterparty
/// @notice Team-funded backstop that takes the opposite side of trader flow in Phase 7.
///         Holds USDC, deposits it into CollateralVault on its own behalf, and exposes
///         owner-only withdrawal behind a timelock. SettlementEngine routes per-fill
///         callbacks to `onFill` so this contract can enforce a per-market position cap
///         and accumulate realised PnL on-chain.
contract SyntheticCounterparty is ISyntheticCounterparty, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @inheritdoc ISyntheticCounterparty
    uint64 public constant TIMELOCK = 2 days;

    /// @inheritdoc ISyntheticCounterparty
    address public immutable USDC;
    /// @inheritdoc ISyntheticCounterparty
    address public immutable VAULT;

    address public override owner;
    address public override settlement;

    mapping(bytes32 => uint256) public override marketCap;
    mapping(bytes32 => int256) public override position;
    mapping(bytes32 => int256) public override realisedPnl;

    PendingWithdraw private _pending;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    constructor(address _owner, address _settlement, address _usdc, address _vault) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_usdc == address(0)) revert ZeroAddress();
        if (_vault == address(0)) revert ZeroAddress();
        owner = _owner;
        settlement = _settlement; // may be zero at deploy; wire up later via setSettlement
        USDC = _usdc;
        VAULT = _vault;
        emit OwnerTransferred(address(0), _owner);
        if (_settlement != address(0)) emit SettlementUpdated(address(0), _settlement);
    }

    // -- admin ----------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setSettlement(address newSettlement) external onlyOwner {
        if (newSettlement == address(0)) revert ZeroAddress();
        emit SettlementUpdated(settlement, newSettlement);
        settlement = newSettlement;
    }

    function setCap(bytes32 marketId, uint256 cap) external onlyOwner {
        emit CapUpdated(marketId, marketCap[marketId], cap);
        marketCap[marketId] = cap;
    }

    // -- funding flow ---------------------------------------------------------

    /// @notice Pull USDC from the caller into custody. Anyone may top up; only the owner
    ///         can withdraw via the timelock path.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, IERC20(USDC).balanceOf(address(this)));
    }

    /// @notice Owner-only push of USDC from custody into CollateralVault under this
    ///         contract's address. Position-aware margin then comes from the vault balance
    ///         exactly like a normal trader account.
    function depositToVault(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(USDC).forceApprove(VAULT, amount);
        ICollateralVault(VAULT).deposit(amount);
        emit VaultDeposit(amount);
    }

    function queueWithdraw(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (_pending.amount != 0) revert WithdrawAlreadyQueued();
        uint64 eta = uint64(block.timestamp) + TIMELOCK;
        _pending = PendingWithdraw({amount: amount, eta: eta});
        emit WithdrawQueued(amount, eta);
    }

    function cancelWithdraw() external onlyOwner {
        if (_pending.amount == 0) revert NoWithdrawQueued();
        uint256 amount = _pending.amount;
        delete _pending;
        emit WithdrawCancelled(amount);
    }

    /// @notice Pull `pending.amount` USDC from the contract's custody to `to`. Reverts if
    ///         the timelock hasn't elapsed or the custody balance is insufficient.
    function executeWithdraw(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        PendingWithdraw memory p = _pending;
        if (p.amount == 0) revert NoWithdrawQueued();
        if (block.timestamp < p.eta) revert WithdrawNotReady(p.eta);
        uint256 bal = IERC20(USDC).balanceOf(address(this));
        if (bal < p.amount) revert InsufficientCustody();
        delete _pending;
        IERC20(USDC).safeTransfer(to, p.amount);
        emit WithdrawExecuted(to, p.amount);
    }

    function pendingWithdraw() external view returns (uint256 amount, uint64 eta) {
        return (_pending.amount, _pending.eta);
    }

    // -- fill hook ------------------------------------------------------------

    /// @inheritdoc IFillHook
    function onFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18, int256 _realisedPnl)
        external
        override
        onlySettlement
    {
        // Only act when SettlementEngine reports a fill that names this contract as the
        // user side. Hook fires for every fill in the batch so we filter on identity
        // rather than relying on the operator to route only counterparty fills.
        if (user != address(this)) return;

        int256 prev = position[marketId];
        int256 next = prev + sizeDelta;
        uint256 abs_ = SignedMath.abs(next);
        uint256 cap = marketCap[marketId];
        if (abs_ > cap) revert CapExceeded(marketId, cap, abs_);

        position[marketId] = next;
        realisedPnl[marketId] += _realisedPnl;
        emit FillRecorded(marketId, sizeDelta, priceX18, next, _realisedPnl);
    }
}
