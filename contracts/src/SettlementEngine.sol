// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ISettlementEngine} from "./interfaces/ISettlementEngine.sol";
import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {ICollateralVault} from "./interfaces/ICollateralVault.sol";
import {IFillHook} from "./interfaces/IFillHook.sol";

/// @title SettlementEngine
/// @notice Authorises and applies batches of fills produced by the off-chain matching engine.
///         Each batch is signed by the operator hot key over an EIP-712 typed-data digest.
///         Per fill, the engine calls PositionRegistry.applyFill, captures
///         (realisedPnl, fundingDelta), adds the fee, and routes the net delta to
///         CollateralVault.applySettlement. Reverts on any single fill error, so the entire
///         batch is atomic.
contract SettlementEngine is ISettlementEngine, EIP712 {
    /// @dev Scale factor between 1e18 PnL math and vault USDC (6 decimals).
    uint256 internal constant USDC_TO_X18 = 1e12;

    /// @inheritdoc ISettlementEngine
    bytes32 public constant FILL_TYPEHASH =
        keccak256("Fill(address user,bytes32 marketId,int256 sizeDelta,uint256 priceX18,int256 fee)");

    /// @inheritdoc ISettlementEngine
    /// @dev EIP-712 requires the referenced sub-type definition to be included after the
    ///      outer type. viem and ethers do the same — keeps typed-data signing portable.
    bytes32 public constant BATCH_TYPEHASH = keccak256(
        "Batch(uint256 nonce,uint64 deadline,Fill[] fills)"
        "Fill(address user,bytes32 marketId,int256 sizeDelta,uint256 priceX18,int256 fee)"
    );

    IPositionRegistry public immutable POSITION_REGISTRY;
    ICollateralVault public immutable COLLATERAL_VAULT;

    address public owner;
    address public override operator;
    /// @notice Optional per-fill callback. When non-zero, applyBatch invokes
    ///         `hook.onFill(user, marketId, sizeDelta, priceX18, realisedPnl)` after each
    ///         fill has settled. A revert in the hook aborts the entire batch.
    address public override fillHook;

    mapping(uint256 => bool) private _usedNonces;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _operator, IPositionRegistry _registry, ICollateralVault _vault)
        EIP712("Perplex", "1")
    {
        if (_owner == address(0)) revert ZeroAddress();
        if (_operator == address(0)) revert ZeroAddress();
        if (address(_registry) == address(0)) revert ZeroAddress();
        if (address(_vault) == address(0)) revert ZeroAddress();
        owner = _owner;
        operator = _operator;
        POSITION_REGISTRY = _registry;
        COLLATERAL_VAULT = _vault;
        emit OperatorUpdated(address(0), _operator);
    }

    // -- admin ----------------------------------------------------------------

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /// @inheritdoc ISettlementEngine
    /// @dev Pass `address(0)` to disable the hook entirely.
    function setFillHook(address newHook) external onlyOwner {
        emit FillHookUpdated(fillHook, newHook);
        fillHook = newHook;
    }

    // -- entrypoint -----------------------------------------------------------

    /// @inheritdoc ISettlementEngine
    function applyBatch(Fill[] calldata fills, uint256 nonce, uint64 deadline, bytes calldata signature)
        external
    {
        if (fills.length == 0) revert EmptyBatch();
        if (block.timestamp > deadline) revert BatchExpired();
        if (_usedNonces[nonce]) revert NonceUsed(nonce);
        _usedNonces[nonce] = true;

        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(BATCH_TYPEHASH, nonce, deadline, _hashFills(fills))));
        if (ECDSA.recover(digest, signature) != operator) revert BadSignature();

        address hook = fillHook;
        for (uint256 i = 0; i < fills.length; ++i) {
            Fill calldata f = fills[i];
            (int256 realisedPnl, int256 fundingDelta) =
                POSITION_REGISTRY.applyFill(f.user, f.marketId, f.sizeDelta, f.priceX18);
            int256 deltaX18 = realisedPnl + fundingDelta + f.fee;
            if (deltaX18 != 0) {
                int256 deltaRaw = _toRawUsdcDelta(deltaX18);
                if (deltaRaw != 0) {
                    COLLATERAL_VAULT.applySettlement(f.user, deltaRaw);
                }
            }
            emit FillSettled(f.user, f.marketId, realisedPnl, fundingDelta, f.fee);
            if (hook != address(0)) {
                IFillHook(hook).onFill(f.user, f.marketId, f.sizeDelta, f.priceX18, realisedPnl);
            }
        }

        emit BatchApplied(nonce, operator, fills.length);
    }

    function nonceUsed(uint256 nonce) external view returns (bool) {
        return _usedNonces[nonce];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -- internals ------------------------------------------------------------

    function _hashFills(Fill[] calldata fills) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](fills.length);
        for (uint256 i = 0; i < fills.length; ++i) {
            Fill calldata f = fills[i];
            hashes[i] =
                keccak256(abi.encode(FILL_TYPEHASH, f.user, f.marketId, f.sizeDelta, f.priceX18, f.fee));
        }
        return keccak256(abi.encodePacked(hashes));
    }

    /// @dev Convert a 1e18-scaled USDC delta into the vault's 6-decimal representation.
    ///      Rounds toward zero (sub-microcent fractions are discarded; the protocol absorbs
    ///      the rounding into the insurance fund in Phase 4).
    function _toRawUsdcDelta(int256 deltaX18) internal pure returns (int256) {
        if (deltaX18 == 0) return 0;
        uint256 absX18 = SignedMath.abs(deltaX18);
        uint256 absRaw = absX18 / USDC_TO_X18;
        if (absRaw == 0) return 0;
        int256 raw = SafeCast.toInt256(absRaw);
        return deltaX18 > 0 ? raw : -raw;
    }
}
