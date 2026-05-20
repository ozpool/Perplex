// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IFundingEngine} from "./interfaces/IFundingEngine.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";

/// @title FundingEngine
/// @notice Advances the per-market cumulative funding index once every `FUNDING_INTERVAL`.
///         The premium for the tick is computed off-chain from the mark-vs-index spread averaged
///         over the elapsed interval and passed in by the authorised submitter. On-chain we
///         enforce the cadence, an absolute bound on the per-tick premium, and that the calling
///         submitter has been authorised by the owner. The new cumulative index is forwarded to
///         `PositionRegistry.updateFunding`, which is gated on this contract's address.
contract FundingEngine is IFundingEngine {
    /// @notice Funding cadence. Eight hours matches the cross-venue convention used by Pyth
    ///         consumers; one tick per interval keeps the on-chain footprint bounded while the
    ///         off-chain relayer averages the premium continuously.
    uint256 public constant FUNDING_INTERVAL = 8 hours;

    /// @notice Per-tick absolute bound on the premium. 1% per 8h tick caps the cumulative drift
    ///         that any single bad relayer submission can do to user positions, and matches the
    ///         clamp dYdX V4 uses on its funding rate.
    int256 public constant MAX_PREMIUM_ABS = 0.01e18;

    IMarketRegistry public immutable MARKETS;
    IPositionRegistry public immutable POSITIONS;

    address public owner;
    address public submitter;

    mapping(bytes32 marketId => uint64) public lastFundingAt;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, IMarketRegistry _markets, IPositionRegistry _positions, address _submitter) {
        if (_owner == address(0)) revert ZeroAddress();
        if (address(_markets) == address(0)) revert ZeroAddress();
        if (address(_positions) == address(0)) revert ZeroAddress();
        if (_submitter == address(0)) revert ZeroAddress();
        owner = _owner;
        MARKETS = _markets;
        POSITIONS = _positions;
        submitter = _submitter;
        emit OwnerUpdated(address(0), _owner);
        emit SubmitterUpdated(address(0), _submitter);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function setSubmitter(address newSubmitter) external onlyOwner {
        if (newSubmitter == address(0)) revert ZeroAddress();
        emit SubmitterUpdated(submitter, newSubmitter);
        submitter = newSubmitter;
    }

    /// @inheritdoc IFundingEngine
    function applyFunding(bytes32 marketId, int256 premiumX18) external {
        if (msg.sender != submitter) revert NotSubmitter();
        if (!MARKETS.isMarketActive(marketId)) revert MarketInactive(marketId);
        if (premiumX18 > MAX_PREMIUM_ABS || premiumX18 < -MAX_PREMIUM_ABS) {
            revert PremiumOutOfBounds(premiumX18);
        }

        uint64 last = lastFundingAt[marketId];
        if (last != 0) {
            uint64 next = last + uint64(FUNDING_INTERVAL);
            if (block.timestamp < next) revert TooSoon(next);
        }

        int256 prev = POSITIONS.marketIndexFunding(marketId);
        int256 newIndex = prev + premiumX18;
        POSITIONS.updateFunding(marketId, newIndex);
        lastFundingAt[marketId] = uint64(block.timestamp);
        emit FundingApplied(marketId, premiumX18, prev, newIndex, uint64(block.timestamp));
    }

    /// @inheritdoc IFundingEngine
    function nextEligibleAt(bytes32 marketId) external view returns (uint64) {
        uint64 last = lastFundingAt[marketId];
        if (last == 0) return 0;
        return last + uint64(FUNDING_INTERVAL);
    }
}
