// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IFundingEngine {
    event FundingApplied(
        bytes32 indexed marketId, int256 premiumX18, int256 previousIndex, int256 newIndex, uint64 ts
    );
    event SubmitterUpdated(address indexed previous, address indexed current);
    event OwnerUpdated(address indexed previous, address indexed current);

    error NotOwner();
    error NotSubmitter();
    error ZeroAddress();
    error MarketInactive(bytes32 marketId);
    error TooSoon(uint64 nextEligible);
    error PremiumOutOfBounds(int256 premium);

    /// @notice Apply one funding tick to a market. The premium is computed off-chain from
    ///         (mark - index) / index averaged over the elapsed interval, scaled 1e18.
    ///         Reverts when called more often than `FUNDING_INTERVAL`, when the premium
    ///         exceeds `MAX_PREMIUM_ABS`, or when the market is inactive.
    function applyFunding(bytes32 marketId, int256 premiumX18) external;

    function lastFundingAt(bytes32 marketId) external view returns (uint64);
    function nextEligibleAt(bytes32 marketId) external view returns (uint64);
    function submitter() external view returns (address);

    function FUNDING_INTERVAL() external view returns (uint256);
    function MAX_PREMIUM_ABS() external view returns (int256);
}
