// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IOracleAdapter {
    error StalePrice(bytes32 marketId, uint256 publishedAt);
    error UnknownFeed(bytes32 marketId);
    error NegativePrice(bytes32 marketId);

    event FeedRegistered(bytes32 indexed marketId, bytes32 feedId);

    function priceX18(bytes32 marketId) external view returns (uint256);

    function updateAndGetPrice(bytes32 marketId, bytes[] calldata updateData)
        external
        payable
        returns (uint256);
}
