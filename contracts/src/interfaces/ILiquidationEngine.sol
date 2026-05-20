// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface ILiquidationEngine {
    struct LiquidationReceipt {
        uint256 markX18;
        int256 closedSize;
        int256 settledDelta;
        uint256 bonusPaid;
        uint256 residualPaid;
        uint256 shortfall;
    }

    event Liquidated(
        address indexed user, bytes32 indexed marketId, address indexed liquidator, LiquidationReceipt receipt
    );

    event AdlExecuted(
        bytes32 indexed marketId, address indexed victim, int256 sizeClosed, uint256 valueTaken
    );

    error Healthy(uint256 healthFactorX18);
    error NoPosition();
    error MarketInactive(bytes32 marketId);
    error OracleStale();
    error ZeroAddress();
    error NotOwner();
    error LengthMismatch();
    error WrongSide();
    error CloseExceedsPosition();
    error NotProfitable();

    /// @notice Auto-deleverage profitable opposite-side positions to absorb a liquidation
    ///         shortfall. The off-chain ranker computes pnl_pct * leverage per docs/margin-math.md
    ///         section 8 and submits the top-ranked positions plus the size to close on each.
    ///         For each (victim, closeSize):
    ///           - reverts if the close direction doesn't reduce the victim's position
    ///           - reverts if the position is not profitable at the current mark
    ///           - applies the partial close, credits realised PnL, then claws back the same
    ///             realised PnL to the insurance fund via debitToExternal
    function adl(bytes32 marketId, address[] calldata victims, int256[] calldata closeSizes) external;

    /// @notice Liquidate a single position. Reverts when health factor >= 1e18 (healthy)
    ///         or when the user has no position in this market. Closes the position at the
    ///         current oracle mark, applies realised PnL + funding to the victim's vault
    ///         balance, then drains what's left to (bonus → caller, residual → insurance fund).
    function liquidate(address user, bytes32 marketId) external;
}
