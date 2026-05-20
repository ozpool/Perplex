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
        address indexed user,
        bytes32 indexed marketId,
        int256 sizeDelta,
        uint256 priceX18,
        int256 realisedPnl
    );

    event FundingSettled(address indexed user, bytes32 indexed marketId, int256 fundingDelta);

    function applyFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18) external;

    function isWithdrawSafe(address user, uint256 amount) external view returns (bool);

    function unrealisedPnl(address user, bytes32 marketId, uint256 oraclePriceX18)
        external
        view
        returns (int256);

    function healthFactor(address user, bytes32 marketId, uint256 priceX18) external view returns (uint256);

    function positions(address user, bytes32 marketId) external view returns (Position memory);

    function markets(bytes32 marketId) external view returns (MarketParams memory);
}
