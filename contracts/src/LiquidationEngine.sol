// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";

import {ILiquidationEngine} from "./interfaces/ILiquidationEngine.sol";
import {IMarketRegistry} from "./interfaces/IMarketRegistry.sol";
import {IPositionRegistry} from "./interfaces/IPositionRegistry.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {ICollateralVault} from "./interfaces/ICollateralVault.sol";
import {IInsuranceFund} from "./interfaces/IInsuranceFund.sol";

/// @title LiquidationEngine
/// @notice Forced-close path triggered by external liquidator bots. The bot calls
///         `liquidate(user, marketId)` when the position's health factor falls below 1.0.
///         The engine closes the position at the oracle mark, applies realised PnL + funding
///         to the victim's vault balance, then forwards the bonus to the liquidator and the
///         residual collateral to the insurance fund. ADL (auto-deleveraging) is handled in
///         a follow-up PR and is not invoked here.
contract LiquidationEngine is ILiquidationEngine {
    /// @dev Scale factor between vault USDC (6 decimals) and price/uPnL math (18 decimals).
    uint256 internal constant USDC_TO_X18 = 1e12;

    IMarketRegistry public immutable MARKETS;
    IPositionRegistry public immutable POSITIONS;
    IOracleAdapter public immutable ORACLE;
    ICollateralVault public immutable VAULT;
    IInsuranceFund public immutable FUND;

    address public owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address _owner,
        IMarketRegistry _markets,
        IPositionRegistry _positions,
        IOracleAdapter _oracle,
        ICollateralVault _vault,
        IInsuranceFund _fund
    ) {
        if (_owner == address(0)) revert ZeroAddress();
        if (address(_markets) == address(0)) revert ZeroAddress();
        if (address(_positions) == address(0)) revert ZeroAddress();
        if (address(_oracle) == address(0)) revert ZeroAddress();
        if (address(_vault) == address(0)) revert ZeroAddress();
        if (address(_fund) == address(0)) revert ZeroAddress();
        owner = _owner;
        MARKETS = _markets;
        POSITIONS = _positions;
        ORACLE = _oracle;
        VAULT = _vault;
        FUND = _fund;
    }

    /// @inheritdoc ILiquidationEngine
    function liquidate(address user, bytes32 marketId) external {
        if (!MARKETS.isMarketActive(marketId)) revert MarketInactive(marketId);
        uint256 mark = ORACLE.priceX18(marketId);
        uint256 hf = POSITIONS.healthFactor(user, marketId, mark);
        if (hf >= 1e18) revert Healthy(hf);

        int256 sizeBefore = POSITIONS.positions(user, marketId).size;
        if (sizeBefore == 0) revert NoPosition();

        uint256 bonusUSDC = _computeBonusUSDC(marketId, mark, sizeBefore);
        int256 settleUSDC = _closeAndSettle(user, marketId, mark, sizeBefore);
        _distribute(user, marketId, mark, -sizeBefore, settleUSDC, bonusUSDC);
    }

    function _computeBonusUSDC(bytes32 marketId, uint256 mark, int256 sizeBefore)
        internal
        view
        returns (uint256)
    {
        IPositionRegistry.MarketParams memory mp = MARKETS.getParams(marketId);
        uint256 notionalX18 = (SignedMath.abs(sizeBefore) * mark) / 1e18;
        uint256 bonusX18 = (notionalX18 * mp.liqBonusBps) / 10_000;
        return bonusX18 / USDC_TO_X18;
    }

    function _closeAndSettle(address user, bytes32 marketId, uint256 mark, int256 sizeBefore)
        internal
        returns (int256 settleUSDC)
    {
        (int256 realised, int256 funding) = POSITIONS.applyFill(user, marketId, -sizeBefore, mark);
        int256 settleX18 = realised + funding;
        settleUSDC = settleX18 / int256(USDC_TO_X18);
        if (settleUSDC != 0) {
            VAULT.applySettlement(user, settleUSDC);
        }
    }

    function _distribute(
        address user,
        bytes32 marketId,
        uint256 mark,
        int256 closedSize,
        int256 settleUSDC,
        uint256 bonusUSDC
    ) internal {
        (uint256 paidBonus, uint256 paidResidual, uint256 shortfall) =
            VAULT.seizeForLiquidation(user, msg.sender, address(FUND), bonusUSDC);
        emit Liquidated(
            user,
            marketId,
            msg.sender,
            LiquidationReceipt({
                markX18: mark,
                closedSize: closedSize,
                settledDelta: settleUSDC,
                bonusPaid: paidBonus,
                residualPaid: paidResidual,
                shortfall: shortfall
            })
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
