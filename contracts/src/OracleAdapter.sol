// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {IChainlinkAggregator} from "./interfaces/IChainlinkAggregator.sol";

/// @title OracleAdapter
/// @notice Production oracle wrapper. Reads Pyth pull-oracle prices as the primary
///         source and cross-checks against a Chainlink AggregatorV3 feed where one is
///         registered. If the two diverge by more than `maxDivergenceBps`, the call
///         reverts so the matching engine pauses the affected market.
///
/// @dev    Prices are normalised to 1e18 USDC per base asset. Pyth's exponent is
///         negative for typical feeds (e.g. -8 for an 8-decimal feed); we apply
///         `scaleToX18` to translate to our 1e18 fixed-point convention.
///         The MockOracle.sol path used in local devnet shares the same
///         IOracleAdapter interface — production wiring swaps OracleAdapter for
///         MockOracle without touching PositionRegistry or the engines.
contract OracleAdapter is IOracleAdapter {
    IPyth public immutable PYTH;
    address public owner;

    /// @notice Max staleness for a Pyth price update before priceX18() reverts. Seconds.
    uint256 public maxStalenessSec;
    /// @notice Max allowed Pyth-vs-Chainlink divergence in basis points (10000 = 100%).
    uint16 public maxDivergenceBps;

    mapping(bytes32 marketId => bytes32 pythFeedId) public pythFeeds;
    mapping(bytes32 marketId => IChainlinkAggregator) public chainlinkFeeds;

    event PythFeedRegistered(bytes32 indexed marketId, bytes32 pythFeedId);
    event ChainlinkFeedRegistered(bytes32 indexed marketId, address feed);
    event ChainlinkFeedCleared(bytes32 indexed marketId);
    event StalenessUpdated(uint256 newMaxStalenessSec);
    event DivergenceUpdated(uint16 newMaxDivergenceBps);

    error NotOwner();
    error ZeroAddress();
    error InvalidStaleness();
    error InvalidDivergence();
    error DivergenceExceeded(bytes32 marketId, uint256 pythX18, uint256 chainlinkX18);
    error ChainlinkStale(bytes32 marketId);
    error UnscaleableExpo(int32 expo);
    error InvalidUpdateFee();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPyth _pyth, address _owner) {
        if (address(_pyth) == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();
        PYTH = _pyth;
        owner = _owner;
        maxStalenessSec = 30;
        maxDivergenceBps = 100; // 1%
    }

    // -- admin ----------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function registerPythFeed(bytes32 marketId, bytes32 pythFeedId) external onlyOwner {
        pythFeeds[marketId] = pythFeedId;
        emit FeedRegistered(marketId, pythFeedId);
        emit PythFeedRegistered(marketId, pythFeedId);
    }

    function setChainlinkFeed(bytes32 marketId, IChainlinkAggregator feed) external onlyOwner {
        chainlinkFeeds[marketId] = feed;
        if (address(feed) == address(0)) {
            emit ChainlinkFeedCleared(marketId);
        } else {
            emit ChainlinkFeedRegistered(marketId, address(feed));
        }
    }

    function setMaxStaleness(uint256 newMaxSec) external onlyOwner {
        if (newMaxSec == 0 || newMaxSec > 1 hours) revert InvalidStaleness();
        maxStalenessSec = newMaxSec;
        emit StalenessUpdated(newMaxSec);
    }

    function setMaxDivergence(uint16 newBps) external onlyOwner {
        if (newBps == 0 || newBps > 10_000) revert InvalidDivergence();
        maxDivergenceBps = newBps;
        emit DivergenceUpdated(newBps);
    }

    // -- IOracleAdapter -------------------------------------------------------

    /// @inheritdoc IOracleAdapter
    function priceX18(bytes32 marketId) external view returns (uint256) {
        bytes32 feedId = pythFeeds[marketId];
        if (feedId == bytes32(0)) revert UnknownFeed(marketId);

        PythStructs.Price memory p = PYTH.getPriceNoOlderThan(feedId, maxStalenessSec);
        if (p.price <= 0) revert NegativePrice(marketId);
        uint256 pythPriceRaw = SafeCast.toUint256(int256(p.price));
        uint256 pythX18 = _scaleToX18(pythPriceRaw, p.expo);

        // Sanity-check against Chainlink if a feed is configured.
        IChainlinkAggregator clf = chainlinkFeeds[marketId];
        if (address(clf) != address(0)) {
            uint256 clX18 = _readChainlinkX18(marketId, clf);
            _assertWithinDivergence(marketId, pythX18, clX18);
        }
        return pythX18;
    }

    /// @inheritdoc IOracleAdapter
    /// @dev Caller forwards the Pyth fee with msg.value. Refunds are returned to msg.sender.
    function updateAndGetPrice(bytes32 marketId, bytes[] calldata updateData)
        external
        payable
        returns (uint256)
    {
        uint256 fee = PYTH.getUpdateFee(updateData);
        if (msg.value < fee) revert InvalidUpdateFee();
        PYTH.updatePriceFeeds{value: fee}(updateData);
        // Refund residual ETH to caller.
        uint256 residual = msg.value - fee;
        if (residual > 0) {
            (bool ok,) = msg.sender.call{value: residual}("");
            require(ok, "refund failed");
        }
        return this.priceX18(marketId);
    }

    // -- internals ------------------------------------------------------------

    function _readChainlinkX18(bytes32 marketId, IChainlinkAggregator feed) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert NegativePrice(marketId);
        // 1 hour staleness floor for Chainlink — they update on heartbeat + deviation;
        // staler than that = likely stuck feed.
        if (block.timestamp - updatedAt > 1 hours) revert ChainlinkStale(marketId);
        uint8 dec = feed.decimals();
        uint256 answerU = SafeCast.toUint256(answer);
        // Chainlink answer is base * 10^decimals. Scale to 1e18.
        if (dec == 18) return answerU;
        if (dec < 18) return answerU * (10 ** (18 - dec));
        return answerU / (10 ** (dec - 18));
    }

    function _assertWithinDivergence(bytes32 marketId, uint256 pythX18, uint256 clX18) internal view {
        uint256 diff = pythX18 > clX18 ? pythX18 - clX18 : clX18 - pythX18;
        uint256 base = pythX18 < clX18 ? pythX18 : clX18; // use lower as base for stricter check
        if (base == 0) revert DivergenceExceeded(marketId, pythX18, clX18);
        // diff / base * 10000 > maxDivergenceBps  <=>  diff * 10000 > base * maxDivergenceBps
        if (diff * 10_000 > base * maxDivergenceBps) {
            revert DivergenceExceeded(marketId, pythX18, clX18);
        }
    }

    /// @dev Pyth prices come as (price: int64, expo: int32). expo is typically negative
    ///      (e.g. -8 means 8 decimals). We scale to 1e18.
    ///      price * 10^(18 + expo) when 18 + expo >= 0
    ///      price / 10^(-(18 + expo)) when 18 + expo < 0
    function _scaleToX18(uint256 price, int32 expo) internal pure returns (uint256) {
        int256 shift = int256(18) + int256(expo);
        if (shift >= 0) {
            if (shift > 38) revert UnscaleableExpo(expo); // 10^38 fits uint256
            uint256 mul = 10 ** SafeCast.toUint256(shift);
            return price * mul;
        } else {
            uint256 div = 10 ** SafeCast.toUint256(-shift);
            return price / div;
        }
    }
}
