// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @notice Optional per-fill callback invoked by SettlementEngine.applyBatch after each
///         fill has been applied to the PositionRegistry and CollateralVault. Implementers
///         filter on `user` themselves (e.g. only act when the user is the synthetic
///         counterparty) and must not revert under normal operation — a revert aborts the
///         entire batch.
interface IFillHook {
    function onFill(
        address user,
        bytes32 marketId,
        int256 sizeDelta,
        uint256 priceX18,
        int256 realisedPnl
    ) external;
}
