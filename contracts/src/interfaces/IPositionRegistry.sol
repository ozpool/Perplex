// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IPositionRegistry {
    struct Position {
        int256 size;
        uint256 entryPriceX18;
        int256 cumulativeFunding;
        uint64 lastUpdatedBlock;
    }

    struct MarketParams {
        uint16 imRatioBps;
        uint16 mmRatioBps;
        uint16 liqBonusBps;
        uint16 takerFeeBps;
        int16 makerRebateBps;
        bool active;
    }

    event FillApplied(
        address indexed user, bytes32 indexed marketId, int256 sizeDelta, uint256 priceX18, int256 realisedPnl
    );

    event FundingSettled(address indexed user, bytes32 indexed marketId, int256 fundingDelta);
    event FundingIndexUpdated(bytes32 indexed marketId, int256 previousIndex, int256 newIndex);

    /// @notice Apply a fill to a position. Settles accrued funding first, then runs VWAP math
    ///         per docs/margin-math.md. Returns the realised PnL on any closed portion and the
    ///         funding delta absorbed since the last touch. Caller (SettlementEngine) is
    ///         responsible for applying both deltas to the collateral vault.
    function applyFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18)
        external
        returns (int256 realisedPnl, int256 fundingDelta);

    /// @notice Advance the cumulative funding index for a market. Phase 4 FundingEngine drives this.
    function updateFunding(bytes32 marketId, int256 newCumulativeIndex) external;

    function isWithdrawSafe(address user, uint256 amount) external view returns (bool);

    function unrealisedPnl(address user, bytes32 marketId, uint256 oraclePriceX18)
        external
        view
        returns (int256);

    /// @notice Health factor scaled 1e18. Below 1e18 means liquidatable.
    ///         Returns type(uint256).max when there is no position in this market.
    function healthFactor(address user, bytes32 marketId, uint256 priceX18) external view returns (uint256);

    /// @notice Liquidation mark price for this single position, scaled 1e18.
    ///         Returns 0 when there is no position in this market.
    ///         Computed as if this were the user's only position; multi-position liquidation
    ///         price is approximated by FE.
    function liquidationPrice(address user, bytes32 marketId) external view returns (uint256);

    function positions(address user, bytes32 marketId) external view returns (Position memory);

    function markets(bytes32 marketId) external view returns (MarketParams memory);
}
