// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";

/// @title MarketRegistry
/// @notice Source of truth for the list of active markets and their risk parameters.
///         Owner-gated; in production the owner is a timelocked governance multisig.
contract MarketRegistry is IMarketRegistry {
    /// @notice Hard caps on per-market risk parameters. Enforced at listing and update time
    ///         to prevent governance from silently approving wildly off-spec markets.
    uint16 internal constant MAX_IM_BPS = 5_000; // 50% — caps minimum 2x leverage floor
    uint16 internal constant MAX_MM_BPS = 2_500; // 25% — must be strictly less than IM
    uint16 internal constant MAX_LIQ_BONUS_BPS = 1_000; // 10%
    uint16 internal constant MAX_TAKER_FEE_BPS = 100; // 1%
    int16 internal constant MIN_MAKER_REBATE_BPS = -50; // -0.5% (rebate paid to maker)
    int16 internal constant MAX_MAKER_FEE_BPS = 50; // +0.5%

    address public owner;
    bytes32[] private _markets;

    mapping(bytes32 marketId => IPositionRegistry.MarketParams) private _params;
    mapping(bytes32 marketId => bool listed) private _isListed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner) {
        if (_owner == address(0)) revert ZeroAddress();
        owner = _owner;
        emit OwnerUpdated(address(0), _owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @inheritdoc IMarketRegistry
    function listMarket(bytes32 marketId, IPositionRegistry.MarketParams calldata params) external onlyOwner {
        if (_isListed[marketId]) revert MarketAlreadyListed(marketId);
        _validate(params);
        _params[marketId] = params;
        _isListed[marketId] = true;
        _markets.push(marketId);
        emit MarketListed(marketId, params);
    }

    /// @inheritdoc IMarketRegistry
    function updateMarket(bytes32 marketId, IPositionRegistry.MarketParams calldata params)
        external
        onlyOwner
    {
        if (!_isListed[marketId]) revert MarketNotListed(marketId);
        _validate(params);
        _params[marketId] = params;
        emit MarketUpdated(marketId, params);
    }

    /// @inheritdoc IMarketRegistry
    function deactivateMarket(bytes32 marketId) external onlyOwner {
        if (!_isListed[marketId]) revert MarketNotListed(marketId);
        _params[marketId].active = false;
        emit MarketDeactivated(marketId);
    }

    function isMarketActive(bytes32 marketId) external view returns (bool) {
        if (!_isListed[marketId]) return false;
        return _params[marketId].active;
    }

    function getParams(bytes32 marketId) external view returns (IPositionRegistry.MarketParams memory) {
        if (!_isListed[marketId]) revert MarketNotListed(marketId);
        return _params[marketId];
    }

    function listedMarkets() external view returns (bytes32[] memory) {
        return _markets;
    }

    function _validate(IPositionRegistry.MarketParams calldata p) internal pure {
        // IM must be a positive ratio and bounded; MM must be strictly less than IM (else withdraw
        // gate is laxer than liquidation gate, breaking the model).
        if (p.imRatioBps == 0 || p.imRatioBps > MAX_IM_BPS) revert InvalidParams();
        if (p.mmRatioBps == 0 || p.mmRatioBps >= p.imRatioBps || p.mmRatioBps > MAX_MM_BPS) {
            revert InvalidParams();
        }
        if (p.liqBonusBps > MAX_LIQ_BONUS_BPS) revert InvalidParams();
        if (p.takerFeeBps > MAX_TAKER_FEE_BPS) revert InvalidParams();
        if (p.makerRebateBps < MIN_MAKER_REBATE_BPS || p.makerRebateBps > MAX_MAKER_FEE_BPS) {
            revert InvalidParams();
        }
    }
}
