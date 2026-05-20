// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IPositionRegistry} from "./IPositionRegistry.sol";

interface IMarketRegistry {
    event MarketListed(bytes32 indexed marketId, IPositionRegistry.MarketParams params);
    event MarketUpdated(bytes32 indexed marketId, IPositionRegistry.MarketParams params);
    event MarketDeactivated(bytes32 indexed marketId);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error MarketAlreadyListed(bytes32 marketId);
    error MarketNotListed(bytes32 marketId);
    error InvalidParams();
    error ZeroAddress();

    function listMarket(bytes32 marketId, IPositionRegistry.MarketParams calldata params) external;
    function updateMarket(bytes32 marketId, IPositionRegistry.MarketParams calldata params) external;
    function deactivateMarket(bytes32 marketId) external;
    function isMarketActive(bytes32 marketId) external view returns (bool);
    function getParams(bytes32 marketId) external view returns (IPositionRegistry.MarketParams memory);
    function listedMarkets() external view returns (bytes32[] memory);
}
