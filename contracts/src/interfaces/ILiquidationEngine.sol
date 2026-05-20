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

    error Healthy(uint256 healthFactorX18);
    error NoPosition();
    error MarketInactive(bytes32 marketId);
    error OracleStale();
    error ZeroAddress();
    error NotOwner();

    /// @notice Liquidate a single position. Reverts when health factor >= 1e18 (healthy)
    ///         or when the user has no position in this market. Closes the position at the
    ///         current oracle mark, applies realised PnL + funding to the victim's vault
    ///         balance, then drains what's left to (bonus → caller, residual → insurance fund).
    function liquidate(address user, bytes32 marketId) external;
}
