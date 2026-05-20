// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";

/// @notice Local devnet + Sepolia oracle. Same interface as OracleAdapter.
/// @dev Manual setPrice() under owner control. Never deploy to mainnet.
contract MockOracle is IOracleAdapter {
    address public immutable owner;

    mapping(bytes32 marketId => uint256 priceX18) private _prices;
    mapping(bytes32 marketId => uint64 publishedAt) public publishedAt;

    error NotOwner();
    error ZeroPrice();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    function setPrice(bytes32 marketId, uint256 newPriceX18) external onlyOwner {
        if (newPriceX18 == 0) revert ZeroPrice();
        _prices[marketId] = newPriceX18;
        publishedAt[marketId] = uint64(block.timestamp);
    }

    function setPrices(bytes32[] calldata marketIds, uint256[] calldata pricesX18) external onlyOwner {
        require(marketIds.length == pricesX18.length, "len mismatch");
        for (uint256 i = 0; i < marketIds.length; ++i) {
            if (pricesX18[i] == 0) revert ZeroPrice();
            _prices[marketIds[i]] = pricesX18[i];
            publishedAt[marketIds[i]] = uint64(block.timestamp);
        }
    }

    function priceX18(bytes32 marketId) external view override returns (uint256) {
        uint256 p = _prices[marketId];
        if (p == 0) revert UnknownFeed(marketId);
        return p;
    }

    /// @dev Mock variant ignores updateData payload; on live deploys Pyth verifies signatures.
    function updateAndGetPrice(bytes32 marketId, bytes[] calldata /*updateData*/ )
        external
        payable
        override
        returns (uint256)
    {
        uint256 p = _prices[marketId];
        if (p == 0) revert UnknownFeed(marketId);
        return p;
    }
}
