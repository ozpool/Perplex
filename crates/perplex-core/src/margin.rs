//! Rust mirror of Solidity PositionRegistry math. Bit-for-bit agreement with the
//! on-chain implementation is enforced by Foundry differential tests.
//!
//! See docs/margin-math.md for worked examples and derivations.

use rust_decimal::Decimal;
use rust_decimal_macros::dec;

use crate::types::{MarketParams, Position};

/// Apply a fill to a position. Returns the realised PnL from any closing portion.
///
/// Mirrors PositionRegistry.applyFill in Solidity.
pub fn apply_fill(p: &mut Position, size_delta: Decimal, fill_price: Decimal) -> Decimal {
    let old_size = p.size;
    let new_size = old_size + size_delta;

    if new_size.is_zero() {
        let realised = old_size * (fill_price - p.entry_price);
        p.size = Decimal::ZERO;
        p.entry_price = Decimal::ZERO;
        return realised;
    }

    let same_side = old_size.signum() == size_delta.signum();

    if same_side {
        let old_notional = old_size.abs() * p.entry_price;
        let add_notional = size_delta.abs() * fill_price;
        p.entry_price = (old_notional + add_notional) / new_size.abs();
        p.size = new_size;
        return Decimal::ZERO;
    }

    let flipped = old_size.signum() != new_size.signum();

    if flipped {
        let realised = old_size * (fill_price - p.entry_price);
        p.size = new_size;
        p.entry_price = fill_price;
        return realised;
    }

    let closed_qty = size_delta.abs();
    let realised = old_size.signum() * closed_qty * (fill_price - p.entry_price);
    p.size = new_size;
    realised
}

/// Unrealised PnL given current mark.
pub fn unrealised_pnl(p: &Position, mark: Decimal) -> Decimal {
    if p.size.is_zero() {
        return Decimal::ZERO;
    }
    p.size * (mark - p.entry_price)
}

/// Notional value of a position at mark.
pub fn notional(p: &Position, mark: Decimal) -> Decimal {
    p.size.abs() * mark
}

/// Initial margin required for a position at mark.
pub fn initial_margin(p: &Position, mark: Decimal, params: &MarketParams) -> Decimal {
    notional(p, mark) * Decimal::from(params.im_ratio_bps) / dec!(10000)
}

/// Maintenance margin required for a position at mark.
pub fn maintenance_margin(p: &Position, mark: Decimal, params: &MarketParams) -> Decimal {
    notional(p, mark) * Decimal::from(params.mm_ratio_bps) / dec!(10000)
}

/// Health factor = equity / maintenance margin. < 1.0 means liquidatable.
/// Returns `None` when MM == 0 (no position).
pub fn health_factor(
    p: &Position,
    mark: Decimal,
    collateral: Decimal,
    params: &MarketParams,
) -> Option<Decimal> {
    let mm = maintenance_margin(p, mark, params);
    if mm.is_zero() {
        return None;
    }
    let equity = collateral + unrealised_pnl(p, mark);
    Some(equity / mm)
}

/// Liquidation price for a single position. Returns None for zero size.
/// Long:  P* = (size*entry - collateral) / (size * (1 - mmRatio))
/// Short: P* = (size*entry + collateral) / (size * (1 + mmRatio))
pub fn liquidation_price(p: &Position, collateral: Decimal, params: &MarketParams) -> Option<Decimal> {
    if p.size.is_zero() {
        return None;
    }
    let mm_ratio = Decimal::from(params.mm_ratio_bps) / dec!(10000);
    let size_abs = p.size.abs();
    if p.size.is_sign_positive() {
        let num = size_abs * p.entry_price - collateral;
        let den = size_abs * (Decimal::ONE - mm_ratio);
        if den.is_zero() {
            return None;
        }
        Some(num / den)
    } else {
        let num = size_abs * p.entry_price + collateral;
        let den = size_abs * (Decimal::ONE + mm_ratio);
        if den.is_zero() {
            return None;
        }
        Some(num / den)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(size: Decimal, entry: Decimal) -> Position {
        Position {
            user: [0; 20],
            market: [0; 32],
            size,
            entry_price: entry,
            cumulative_funding: Decimal::ZERO,
            last_updated_ts_ns: 0,
        }
    }

    #[test]
    fn vwap_add_to_long() {
        let mut p = pos(dec!(0.10), dec!(100000));
        let realised = apply_fill(&mut p, dec!(0.05), dec!(98000));
        assert_eq!(realised, Decimal::ZERO);
        assert_eq!(p.size, dec!(0.15));
        // (10000 + 4900) / 0.15 = 99333.333...
        let expected = dec!(99333.3333333333333333333333333);
        let diff = (p.entry_price - expected).abs();
        assert!(diff < dec!(0.0000000001), "got {}", p.entry_price);
    }

    #[test]
    fn partial_close_long() {
        let mut p = pos(dec!(0.15), dec!(99333.33333333333333));
        let realised = apply_fill(&mut p, dec!(-0.05), dec!(100500));
        assert_eq!(p.size, dec!(0.10));
        assert_eq!(p.entry_price, dec!(99333.33333333333333));
        // 0.05 * (100500 - 99333.33333) ≈ 58.33
        assert!((realised - dec!(58.333333333333335)).abs() < dec!(0.0000001));
    }

    #[test]
    fn flip_long_to_short() {
        let mut p = pos(dec!(0.10), dec!(99333.33));
        let realised = apply_fill(&mut p, dec!(-0.15), dec!(100000));
        assert_eq!(p.size, dec!(-0.05));
        assert_eq!(p.entry_price, dec!(100000));
        // realised = 0.10 * (100000 - 99333.33) = 66.667
        assert!((realised - dec!(66.667)).abs() < dec!(0.01));
    }

    #[test]
    fn full_close() {
        let mut p = pos(dec!(0.10), dec!(100000));
        let realised = apply_fill(&mut p, dec!(-0.10), dec!(105000));
        assert_eq!(p.size, Decimal::ZERO);
        assert_eq!(p.entry_price, Decimal::ZERO);
        assert_eq!(realised, dec!(500.0));
    }

    #[test]
    fn liquidation_price_long_example() {
        let p = pos(dec!(0.10), dec!(100000));
        let params = MarketParams {
            im_ratio_bps: 500,
            mm_ratio_bps: 250,
            liq_bonus_bps: 100,
            taker_fee_bps: 5,
            maker_rebate_bps: -2,
            active: true,
        };
        let liq = liquidation_price(&p, dec!(1500), &params).unwrap();
        // expected 87179.49 from docs/margin-math.md
        assert!((liq - dec!(87179.487179487179)).abs() < dec!(0.01), "got {}", liq);
    }
}
