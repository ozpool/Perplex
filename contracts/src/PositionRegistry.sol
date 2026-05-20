// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "./interfaces/ICollateralVault.sol";

/// @title PositionRegistry
/// @notice Authoritative position state per (user, market). Non-upgradable by design.
/// @dev Phase 1 ships the storage layout, the access-controlled applyFill stub, the funding
///      lazy-settle stub, and the isWithdrawSafe view that the CollateralVault depends on.
///      Full VWAP / PnL / health-factor logic ships in Phase 2; this stub keeps the wire
///      contract intact and enables the deposit / withdraw flow against a non-trading user.
contract PositionRegistry is IPositionRegistry {
    IMarketRegistry public immutable MARKETS;
    IOracleAdapter public immutable ORACLE;
    ICollateralVault public collateralVault; // settable once
    address public settlementEngine;
    address public liquidationEngine;
    address public owner;

    /// @notice user => marketId => Position
    mapping(address => mapping(bytes32 => Position)) private _positions;

    /// @notice user => list of marketIds the user has touched. Walked by isWithdrawSafe.
    ///         Cleared per market when a position fully closes.
    mapping(address => bytes32[]) private _userMarkets;
    mapping(address => mapping(bytes32 => uint256)) private _userMarketIndexPlusOne; // 0 means not present

    /// @notice global cumulative funding index per market, scaled 1e18.
    mapping(bytes32 => int256) public marketIndexFunding;

    error NotOwner();
    error NotSettlement();
    error AlreadyWired();
    error ZeroAddress();
    error MarketInactive(bytes32 marketId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlementEngine && msg.sender != liquidationEngine) revert NotSettlement();
        _;
    }

    constructor(address _owner, IMarketRegistry _markets, IOracleAdapter _oracle) {
        if (_owner == address(0)) revert ZeroAddress();
        if (address(_markets) == address(0)) revert ZeroAddress();
        if (address(_oracle) == address(0)) revert ZeroAddress();
        owner = _owner;
        MARKETS = _markets;
        ORACLE = _oracle;
    }

    /// @notice Wires the collateral vault and the two engines that may write to balances.
    /// @dev Callable once. The PositionRegistry is deployed BEFORE the CollateralVault so the
    ///      CollateralVault constructor can take a registry address; the back-reference is then
    ///      bound here exactly once.
    function setWiring(ICollateralVault _vault, address _settlement, address _liquidation)
        external
        onlyOwner
    {
        if (address(collateralVault) != address(0)) revert AlreadyWired();
        if (address(_vault) == address(0)) revert ZeroAddress();
        if (_settlement == address(0)) revert ZeroAddress();
        if (_liquidation == address(0)) revert ZeroAddress();
        collateralVault = _vault;
        settlementEngine = _settlement;
        liquidationEngine = _liquidation;
    }

    /// @inheritdoc IPositionRegistry
    /// @dev Phase 1 stub: validates inputs and bumps lastUpdatedBlock; the VWAP entry math,
    ///      funding settlement, and event-emitted realised PnL all land in Phase 2.
    function applyFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18)
        external
        onlySettlement
    {
        if (!MARKETS.isMarketActive(marketId)) revert MarketInactive(marketId);
        require(user != address(0), "user=0");
        require(sizeDelta != 0, "delta=0");
        require(priceX18 > 0, "price=0");

        Position storage p = _positions[user][marketId];
        _trackUserMarket(user, marketId);
        // Phase 2 wires:
        //   _settleFunding(p, marketId);
        //   _applyVwap(p, sizeDelta, priceX18);
        //   uint256 realised = _maybeRealisePnl(...);
        //   emit FillApplied(user, marketId, sizeDelta, priceX18, int256(realised));
        p.lastUpdatedBlock = uint64(block.number);
        emit FillApplied(user, marketId, sizeDelta, priceX18, 0);
    }

    /// @inheritdoc IPositionRegistry
    /// @dev Phase 1 stub: returns true while no positions exist. Phase 2 walks _userMarkets,
    ///      sums unrealised PnL and IM requirements, and applies the formula in
    ///      docs/margin-math.md section 6.
    function isWithdrawSafe(address user, uint256 amount) external view returns (bool) {
        bytes32[] memory markets = _userMarkets[user];
        if (markets.length == 0) return true;
        // Phase 2 implementation will compute:
        //   postEquity = (vaultBalance - amount) + Σ uPnL
        //   sumIM      = Σ IM_required
        //   return postEquity >= sumIM
        // For Phase 1 we return false if the user has touched any market without yet having
        // the math in place, so withdrawals on traded accounts are blocked until Phase 2 lands.
        amount; // silence unused
        return false;
    }

    /// @inheritdoc IPositionRegistry
    function unrealisedPnl(
        address,
        /*user*/
        bytes32,
        /*marketId*/
        uint256 /*oraclePriceX18*/
    )
        external
        pure
        returns (int256)
    {
        return 0;
    }

    /// @inheritdoc IPositionRegistry
    function healthFactor(
        address,
        /*user*/
        bytes32,
        /*marketId*/
        uint256 /*priceX18*/
    )
        external
        pure
        returns (uint256)
    {
        return type(uint256).max;
    }

    /// @inheritdoc IPositionRegistry
    function positions(address user, bytes32 marketId) external view returns (Position memory) {
        return _positions[user][marketId];
    }

    /// @inheritdoc IPositionRegistry
    function markets(bytes32 marketId) external view returns (MarketParams memory) {
        return MARKETS.getParams(marketId);
    }

    function _trackUserMarket(address user, bytes32 marketId) internal {
        if (_userMarketIndexPlusOne[user][marketId] != 0) return;
        _userMarkets[user].push(marketId);
        _userMarketIndexPlusOne[user][marketId] = _userMarkets[user].length;
    }

    // Suppress unused — SignedMath is imported for use in Phase 2.
    function _absSizeForPhase2(int256 v) internal pure returns (uint256) {
        return SignedMath.abs(v);
    }
}
