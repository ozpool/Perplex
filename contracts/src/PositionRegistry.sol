// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "./interfaces/ICollateralVault.sol";

/// @title PositionRegistry
/// @notice Authoritative position state per (user, market). Non-upgradable by design.
///         Implements the VWAP / PnL / funding / health-factor / withdrawal-safety math
///         from docs/margin-math.md. Vault credits and debits are NOT performed here —
///         applyFill returns the realised and funding deltas to the SettlementEngine
///         caller, which routes them through CollateralVault.applySettlement atomically
///         with the opposite-side counterparty's fill.
contract PositionRegistry is IPositionRegistry {
    using SafeCast for int256;
    using SafeCast for uint256;

    /// @dev Scale factor between vault USDC (6 decimals) and price/uPnL math (18 decimals).
    uint256 internal constant USDC_TO_X18 = 1e12;

    IMarketRegistry public immutable MARKETS;
    IOracleAdapter public immutable ORACLE;
    ICollateralVault public collateralVault; // settable once
    address public settlementEngine;
    address public liquidationEngine;
    address public fundingEngine;
    address public owner;

    /// @notice user => marketId => Position
    mapping(address => mapping(bytes32 => Position)) private _positions;

    /// @notice user => list of marketIds the user has touched.
    mapping(address => bytes32[]) private _userMarkets;
    mapping(address => mapping(bytes32 => uint256)) private _userMarketIndexPlusOne; // 0 = not present

    /// @notice global cumulative funding index per market, scaled 1e18.
    mapping(bytes32 => int256) public marketIndexFunding;

    error NotOwner();
    error NotSettlement();
    error NotFundingAuthority();
    error AlreadyWired();
    error FundingAlreadySet();
    error ZeroAddress();
    error MarketInactive(bytes32 marketId);
    error VaultUnavailable();

    event FundingEngineSet(address indexed engine);

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

    /// @notice Bind the back-references to the vault and the two engines. Callable once.
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

    /// @notice Bind the funding engine. Callable once by owner.
    function setFundingEngine(address _funding) external onlyOwner {
        if (fundingEngine != address(0)) revert FundingAlreadySet();
        if (_funding == address(0)) revert ZeroAddress();
        fundingEngine = _funding;
        emit FundingEngineSet(_funding);
    }

    // -- write paths ----------------------------------------------------------

    /// @inheritdoc IPositionRegistry
    function applyFill(address user, bytes32 marketId, int256 sizeDelta, uint256 priceX18)
        external
        onlySettlement
        returns (int256 realisedPnl, int256 fundingDelta)
    {
        if (!MARKETS.isMarketActive(marketId)) revert MarketInactive(marketId);
        require(user != address(0), "user=0");
        require(sizeDelta != 0, "delta=0");
        require(priceX18 > 0, "price=0");

        Position storage p = _positions[user][marketId];

        // 1. Settle funding since last touch.
        fundingDelta = _settleFunding(p, marketId, user);

        // 2. VWAP / PnL math.
        realisedPnl = _applyVwap(p, sizeDelta, priceX18);

        // 3. Track this market for the user (idempotent).
        _trackUserMarket(user, marketId);

        // 4. If position fully closed, untrack and drop entry price.
        if (p.size == 0) {
            _untrackUserMarket(user, marketId);
            p.entryPriceX18 = 0;
        }

        p.lastUpdatedBlock = uint64(block.number);
        emit FillApplied(user, marketId, sizeDelta, priceX18, realisedPnl);
    }

    /// @inheritdoc IPositionRegistry
    function updateFunding(bytes32 marketId, int256 newCumulativeIndex) external {
        if (msg.sender != fundingEngine && msg.sender != owner) revert NotFundingAuthority();
        int256 prev = marketIndexFunding[marketId];
        marketIndexFunding[marketId] = newCumulativeIndex;
        emit FundingIndexUpdated(marketId, prev, newCumulativeIndex);
    }

    // -- view paths -----------------------------------------------------------

    /// @inheritdoc IPositionRegistry
    function unrealisedPnl(address user, bytes32 marketId, uint256 oraclePriceX18)
        external
        view
        returns (int256)
    {
        Position memory p = _positions[user][marketId];
        return _unrealisedPnl(p, oraclePriceX18);
    }

    /// @inheritdoc IPositionRegistry
    function healthFactor(address user, bytes32 marketId, uint256 priceX18) external view returns (uint256) {
        Position memory p = _positions[user][marketId];
        if (p.size == 0) return type(uint256).max;
        MarketParams memory mp = MARKETS.getParams(marketId);
        uint256 notional = _notional(p.size, priceX18);
        uint256 mmX18 = (notional * mp.mmRatioBps) / 10_000;
        if (mmX18 == 0) return type(uint256).max;

        uint256 vaultBalRaw = address(collateralVault) == address(0) ? 0 : collateralVault.balances(user);
        int256 equityX18 = SafeCast.toInt256(vaultBalRaw * USDC_TO_X18) + _unrealisedPnl(p, priceX18);
        if (equityX18 <= 0) return 0;
        return (SafeCast.toUint256(equityX18) * 1e18) / mmX18;
    }

    /// @inheritdoc IPositionRegistry
    function liquidationPrice(address user, bytes32 marketId) external view returns (uint256) {
        Position memory p = _positions[user][marketId];
        if (p.size == 0) return 0;
        MarketParams memory mp = MARKETS.getParams(marketId);
        uint256 mmRatio = uint256(mp.mmRatioBps) * 1e14; // 250 bps -> 0.025 * 1e18

        uint256 vaultBalRaw = address(collateralVault) == address(0) ? 0 : collateralVault.balances(user);
        uint256 collateralX18 = vaultBalRaw * USDC_TO_X18;
        uint256 sizeAbsX18 = SignedMath.abs(p.size);
        uint256 entry = p.entryPriceX18;

        if (p.size > 0) {
            // Long: P* = (size*entry - collateral) / (size * (1 - mmRatio))
            uint256 num = (sizeAbsX18 * entry) / 1e18;
            if (collateralX18 >= num) return 0; // already past zero
            num -= collateralX18;
            // size * (1 - mmRatio) in normalised units; sizeAbsX18 is 1e18-scaled, (1 - mmRatio)
            // expressed as (1e18 - mmRatio) gives a 1e18-scaled multiplier.
            uint256 den = (sizeAbsX18 * (1e18 - mmRatio)) / 1e18;
            return (num * 1e18) / den;
        } else {
            // Short: P* = (size*entry + collateral) / (size * (1 + mmRatio))
            uint256 num = (sizeAbsX18 * entry) / 1e18 + collateralX18;
            uint256 den = (sizeAbsX18 * (1e18 + mmRatio)) / 1e18;
            return (num * 1e18) / den;
        }
    }

    /// @inheritdoc IPositionRegistry
    /// @dev Implements docs/margin-math.md section 6:
    ///         postEquity = (vaultBalance - amount) + Σ uPnL
    ///         sumIM      = Σ IM_required
    ///         return postEquity >= sumIM
    function isWithdrawSafe(address user, uint256 amount) external view returns (bool) {
        bytes32[] memory userMkts = _userMarkets[user];
        if (userMkts.length == 0) return true;
        if (address(collateralVault) == address(0)) return false;

        uint256 vaultBalRaw = collateralVault.balances(user);
        if (amount > vaultBalRaw) return false;

        int256 sumUPnLX18 = 0;
        uint256 sumImX18 = 0;
        for (uint256 i = 0; i < userMkts.length; ++i) {
            bytes32 mid = userMkts[i];
            Position memory p = _positions[user][mid];
            if (p.size == 0) continue;
            MarketParams memory mp = MARKETS.getParams(mid);
            uint256 priceX18 = ORACLE.priceX18(mid);
            sumUPnLX18 += _unrealisedPnl(p, priceX18);
            uint256 notional = _notional(p.size, priceX18);
            sumImX18 += (notional * mp.imRatioBps) / 10_000;
        }

        // All quantities in 1e18 USDC units for the comparison.
        int256 postEquityX18 = SafeCast.toInt256((vaultBalRaw - amount) * USDC_TO_X18) + sumUPnLX18;
        return postEquityX18 >= SafeCast.toInt256(sumImX18);
    }

    /// @inheritdoc IPositionRegistry
    function positions(address user, bytes32 marketId) external view returns (Position memory) {
        return _positions[user][marketId];
    }

    /// @inheritdoc IPositionRegistry
    function markets(bytes32 marketId) external view returns (MarketParams memory) {
        return MARKETS.getParams(marketId);
    }

    // -- internals ------------------------------------------------------------

    /// @dev Settle funding accrued since the position's last touch.
    ///      fundingDelta = (currentIndex - p.cumulativeFunding) * size / 1e18
    ///      Sign convention matches docs/margin-math.md section 7:
    ///        index up + size > 0 (long)  =>  delta > 0  =>  long pays  =>  user realises -|delta|
    ///        index up + size < 0 (short) =>  delta < 0  =>  short receives  =>  user realises +|delta|
    ///      We return the *user-side cashflow*: `-fundingDelta` of the raw product.
    function _settleFunding(Position storage p, bytes32 marketId, address user) internal returns (int256) {
        int256 idx = marketIndexFunding[marketId];
        if (p.size == 0 || p.cumulativeFunding == idx) {
            p.cumulativeFunding = idx;
            return 0;
        }
        int256 indexDelta = idx - p.cumulativeFunding;
        int256 product = (indexDelta * p.size) / 1e18;
        int256 cashflow = -product;
        p.cumulativeFunding = idx;
        emit FundingSettled(user, marketId, cashflow);
        return cashflow;
    }

    /// @dev VWAP / PnL math per docs/margin-math.md sections 1-3.
    function _applyVwap(Position storage p, int256 sizeDelta, uint256 priceX18) internal returns (int256) {
        int256 oldSize = p.size;
        int256 newSize = oldSize + sizeDelta;

        // Full close.
        if (newSize == 0) {
            int256 priceDeltaFull = SafeCast.toInt256(priceX18) - SafeCast.toInt256(p.entryPriceX18);
            int256 realised = (oldSize * priceDeltaFull) / 1e18;
            p.size = 0;
            return realised;
        }

        // Opening fill (no prior position).
        if (oldSize == 0) {
            p.size = newSize;
            p.entryPriceX18 = priceX18;
            return 0;
        }

        bool sameSide = (oldSize > 0) == (sizeDelta > 0);

        if (sameSide) {
            // Add to position. Entry becomes size-weighted average. No realised PnL.
            uint256 oldNotional = SignedMath.abs(oldSize) * p.entryPriceX18;
            uint256 addNotional = SignedMath.abs(sizeDelta) * priceX18;
            uint256 newAbs = SignedMath.abs(newSize);
            p.entryPriceX18 = (oldNotional + addNotional) / newAbs;
            p.size = newSize;
            return 0;
        }

        // Opposite-side fill: either partial close or flip.
        bool flipped = (oldSize > 0) != (newSize > 0);

        if (flipped) {
            // Close entire old position at fill price, then open new in opposite direction at fill.
            int256 priceDeltaFlip = SafeCast.toInt256(priceX18) - SafeCast.toInt256(p.entryPriceX18);
            int256 realised = (oldSize * priceDeltaFlip) / 1e18;
            p.entryPriceX18 = priceX18;
            p.size = newSize;
            return realised;
        }

        // Partial close: entry unchanged, realise PnL on the closed portion.
        uint256 closedQty = SignedMath.abs(sizeDelta);
        int256 priceDelta = SafeCast.toInt256(priceX18) - SafeCast.toInt256(p.entryPriceX18);
        int256 sign = oldSize > 0 ? int256(1) : int256(-1);
        int256 realised2 = (sign * SafeCast.toInt256(closedQty) * priceDelta) / 1e18;
        p.size = newSize;
        return realised2;
    }

    function _unrealisedPnl(Position memory p, uint256 markX18) internal pure returns (int256) {
        if (p.size == 0) return 0;
        int256 priceDelta = SafeCast.toInt256(markX18) - SafeCast.toInt256(p.entryPriceX18);
        return (p.size * priceDelta) / 1e18;
    }

    function _notional(int256 size, uint256 markX18) internal pure returns (uint256) {
        return (SignedMath.abs(size) * markX18) / 1e18;
    }

    function _trackUserMarket(address user, bytes32 marketId) internal {
        if (_userMarketIndexPlusOne[user][marketId] != 0) return;
        _userMarkets[user].push(marketId);
        _userMarketIndexPlusOne[user][marketId] = _userMarkets[user].length;
    }

    function _untrackUserMarket(address user, bytes32 marketId) internal {
        uint256 idx1 = _userMarketIndexPlusOne[user][marketId];
        if (idx1 == 0) return;
        uint256 last = _userMarkets[user].length;
        if (idx1 != last) {
            bytes32 lastMid = _userMarkets[user][last - 1];
            _userMarkets[user][idx1 - 1] = lastMid;
            _userMarketIndexPlusOne[user][lastMid] = idx1;
        }
        _userMarkets[user].pop();
        delete _userMarketIndexPlusOne[user][marketId];
    }
}
