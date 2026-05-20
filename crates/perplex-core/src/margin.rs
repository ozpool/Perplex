//! Rust mirror of Solidity PositionRegistry math. Bit-for-bit agreement with the
//! on-chain implementation is enforced by Foundry differential tests.
//!
//! See docs/margin-math.md for worked examples and derivations.

use rust_decimal::prelude::Signed;
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
pub fn liquidation_price(
    p: &Position,
    collateral: Decimal,
    params: &MarketParams,
) -> Option<Decimal> {
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
        // Algebraic identity: entry * size == old_notional + add_notional
        let total_notional = p.entry_price * p.size;
        assert!(
            (total_notional - dec!(14900)).abs() < dec!(0.0000000001),
            "entry={} size={} notional={}",
            p.entry_price,
            p.size,
            total_notional
        );
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
        assert!(
            (liq - dec!(87179.487179487179)).abs() < dec!(0.01),
            "got {}",
            liq
        );
    }

    use proptest::prelude::*;

    /// Random Decimal with magnitude in [10^-3, 10^5] and chosen sign.
    fn arb_size() -> impl Strategy<Value = Decimal> {
        (1i64..=100_000, prop::bool::ANY).prop_map(|(n, neg)| {
            let v = Decimal::new(n, 3);
            if neg { -v } else { v }
        })
    }

    /// Random Decimal with magnitude in [50, 200_000].
    fn arb_price() -> impl Strategy<Value = Decimal> {
        (50_000i64..=200_000_000).prop_map(|n| Decimal::new(n, 3))
    }

    proptest! {
        /// Opening into an empty position must record entry == fill_price and realise nothing.
        #[test]
        fn invariant_open_records_fill_price(
            delta in arb_size(),
            price in arb_price(),
        ) {
            let mut p = pos(Decimal::ZERO, Decimal::ZERO);
            let realised = apply_fill(&mut p, delta, price);
            prop_assert_eq!(realised, Decimal::ZERO);
            prop_assert_eq!(p.size, delta);
            prop_assert_eq!(p.entry_price, price);
        }

        /// Same-side add: realised == 0 AND the new entry lies between min and max of
        /// (old_entry, fill_price).
        #[test]
        fn invariant_same_side_add_entry_bounded(
            init_size in arb_size().prop_filter("nonzero", |s| !s.is_zero()),
            init_entry in arb_price(),
            add_mag in 1i64..=10_000,
            fill_price in arb_price(),
        ) {
            let mut p = pos(init_size, init_entry);
            // same-side add: same sign as init_size
            let add = if init_size.is_sign_positive() {
                Decimal::new(add_mag, 3)
            } else {
                -Decimal::new(add_mag, 3)
            };
            let realised = apply_fill(&mut p, add, fill_price);
            prop_assert_eq!(realised, Decimal::ZERO);
            let lo = init_entry.min(fill_price);
            let hi = init_entry.max(fill_price);
            prop_assert!(p.entry_price >= lo, "entry {} < lo {}", p.entry_price, lo);
            prop_assert!(p.entry_price <= hi, "entry {} > hi {}", p.entry_price, hi);
        }

        /// Full close: size and entry zeroed, realised matches old_size * (price - entry).
        #[test]
        fn invariant_full_close(
            init_size in arb_size().prop_filter("nonzero", |s| !s.is_zero()),
            init_entry in arb_price(),
            fill_price in arb_price(),
        ) {
            let mut p = pos(init_size, init_entry);
            let realised = apply_fill(&mut p, -init_size, fill_price);
            prop_assert_eq!(p.size, Decimal::ZERO);
            prop_assert_eq!(p.entry_price, Decimal::ZERO);
            let expected = init_size * (fill_price - init_entry);
            prop_assert_eq!(realised, expected);
        }

        /// Partial close (opposite side but not flipped): entry UNCHANGED.
        #[test]
        fn invariant_partial_close_entry_unchanged(
            init_mag in 100i64..=100_000,
            init_pos in prop::bool::ANY,
            init_entry in arb_price(),
            close_frac_n in 1i64..=99,
            fill_price in arb_price(),
        ) {
            let init_size = if init_pos { Decimal::new(init_mag, 3) } else { -Decimal::new(init_mag, 3) };
            // partial close: same magnitude direction (opposite sign of size), less than |init|
            let close_mag = init_mag * close_frac_n / 100;
            let close = if init_size.is_sign_positive() {
                -Decimal::new(close_mag, 3)
            } else {
                Decimal::new(close_mag, 3)
            };
            // Skip degenerate cases where rounding zeroes the close.
            if close.is_zero() {
                return Ok(());
            }
            let mut p = pos(init_size, init_entry);
            apply_fill(&mut p, close, fill_price);
            prop_assert_eq!(p.entry_price, init_entry);
        }
    }
}
