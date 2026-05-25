//! Pure pricing strategy. Inputs: mid price, current inventory (positive = long), recent
//! realised volatility (standard deviation of log-returns over the configured window).
//! Outputs a `(bid, ask)` pair after applying base spread, inventory penalty,
//! volatility multiplier, and an inventory skew.
//!
//! Formula (per PRD v1.1 section 12 / Phase 7 issue #44):
//!
//! ```text
//! spread_bps     = base_spread_bps
//!                + (|inv| / inv_max) * inv_penalty_bps
//!                + realised_vol * vol_mult_bps
//! skew_bps       = clamp(inv / inv_max, -1, 1) * inv_skew_bps_at_max
//! skewed_mid     = mid * (1 - skew_bps / 1e4)
//! bid            = skewed_mid * (1 - spread_bps / 2 / 1e4)
//! ask            = skewed_mid * (1 + spread_bps / 2 / 1e4)
//! ```
//!
//! Skew sign convention: a positive inventory (counterparty net long) pushes the mid
//! *down* so the ask becomes more attractive to external buyers and the bid less
//! attractive to external sellers, draining inventory back toward neutral.

#[derive(Debug, Clone, Copy)]
pub struct StrategyParams {
    pub base_spread_bps: u32,
    /// Bps added to the spread at `|inv| == inv_max`. Linear interpolation between 0 and
    /// the configured cap.
    pub inv_penalty_bps_at_max: u32,
    /// Inventory magnitude (base-asset units) at which the inventory penalty saturates.
    /// Anything above this contributes the full penalty.
    pub inv_max: f64,
    /// Bps added to the spread per unit of realised volatility (decimal, eg. `0.01` for 1%).
    /// `vol_mult_bps` of 1000 with vol=0.01 contributes 10 bps.
    pub vol_mult_bps: u32,
    /// Mid skew applied at `|inv| == inv_max`. Positive shifts mid further into the
    /// inventory-clearing direction; zero disables skew.
    pub inv_skew_bps_at_max: u32,
}

impl Default for StrategyParams {
    fn default() -> Self {
        Self {
            base_spread_bps: 10,
            inv_penalty_bps_at_max: 20,
            inv_max: 100.0,
            vol_mult_bps: 1000,
            inv_skew_bps_at_max: 5,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Quotes {
    pub bid: f64,
    pub ask: f64,
    pub spread_bps: f64,
    pub skew_bps: f64,
}

impl StrategyParams {
    /// Compute `(bid, ask)` plus the derived spread/skew for telemetry.
    ///
    /// `inventory` is signed in base-asset units. `realised_vol` is decimal stdev of
    /// log-returns over the configured window (eg. `0.0025` for 25 bps over the window).
    pub fn quotes(&self, mid: f64, inventory: f64, realised_vol: f64) -> Quotes {
        let inv_ratio_signed = if self.inv_max > 0.0 {
            (inventory / self.inv_max).clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let inv_pen_bps = inv_ratio_signed.abs() * self.inv_penalty_bps_at_max as f64;
        let vol_pen_bps = realised_vol.max(0.0) * self.vol_mult_bps as f64;
        let spread_bps = self.base_spread_bps as f64 + inv_pen_bps + vol_pen_bps;

        // Skew: positive inventory → negative skew → mid shifted down.
        let skew_bps = -inv_ratio_signed * self.inv_skew_bps_at_max as f64;
        let skewed_mid = mid * (1.0 + skew_bps / 10_000.0);

        let half_spread = spread_bps / 2.0 / 10_000.0;
        Quotes {
            bid: skewed_mid * (1.0 - half_spread),
            ask: skewed_mid * (1.0 + half_spread),
            spread_bps,
            skew_bps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, eps: f64) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn flat_inventory_and_no_vol_is_pure_base_spread() {
        let p = StrategyParams {
            base_spread_bps: 10,
            inv_penalty_bps_at_max: 20,
            inv_max: 100.0,
            vol_mult_bps: 1000,
            inv_skew_bps_at_max: 5,
        };
        let q = p.quotes(100.0, 0.0, 0.0);
        assert!(approx(q.spread_bps, 10.0, 1e-9));
        assert!(approx(q.skew_bps, 0.0, 1e-9));
        // ±5 bps off 100.0 = 0.05.
        assert!(approx(q.bid, 99.95, 1e-6));
        assert!(approx(q.ask, 100.05, 1e-6));
    }

    #[test]
    fn long_inventory_skews_mid_down_and_widens_spread() {
        let p = StrategyParams {
            base_spread_bps: 10,
            inv_penalty_bps_at_max: 20,
            inv_max: 100.0,
            vol_mult_bps: 0,
            inv_skew_bps_at_max: 10,
        };
        let q = p.quotes(100.0, 50.0, 0.0);
        // |inv|/max = 0.5 → +10 bps penalty → 20 bps total spread
        assert!(approx(q.spread_bps, 20.0, 1e-9));
        // skew = -0.5 * 10 = -5 bps → mid shifted to 100 * (1 - 0.0005) = 99.95
        assert!(approx(q.skew_bps, -5.0, 1e-9));
        // bid = 99.95 * (1 - 0.001) = 99.85005
        assert!(approx(q.bid, 99.85005, 1e-5));
        // ask = 99.95 * (1 + 0.001) = 100.04995
        assert!(approx(q.ask, 100.04995, 1e-5));

        // CRUCIAL: relative to a flat-inventory quote at the same mid, the skewed bid AND
        // ask both shift LOWER, encouraging external buyers (who lift the ask) and
        // discouraging external sellers (who hit the bid). The combination drains inventory
        // back toward neutral.
        let flat = p.quotes(100.0, 0.0, 0.0);
        assert!(q.bid < flat.bid);
        assert!(q.ask < flat.ask);
    }

    #[test]
    fn short_inventory_skews_mid_up() {
        let p = StrategyParams {
            inv_skew_bps_at_max: 10,
            ..Default::default()
        };
        let q = p.quotes(100.0, -50.0, 0.0);
        assert!(q.skew_bps > 0.0, "short inventory shifts skew up");
        // Bid should rise above original mid (we want sellers to hit us).
        assert!(q.bid > 99.0);
    }

    #[test]
    fn realised_vol_widens_spread() {
        let p = StrategyParams {
            base_spread_bps: 10,
            inv_penalty_bps_at_max: 0,
            inv_max: 100.0,
            vol_mult_bps: 1000,
            inv_skew_bps_at_max: 0,
        };
        let calm = p.quotes(100.0, 0.0, 0.0).spread_bps;
        let stormy = p.quotes(100.0, 0.0, 0.01).spread_bps;
        // 0.01 vol * 1000 = +10 bps.
        assert!(approx(stormy - calm, 10.0, 1e-9));
    }

    #[test]
    fn inventory_at_or_above_cap_saturates_penalty() {
        let p = StrategyParams {
            inv_penalty_bps_at_max: 30,
            inv_max: 100.0,
            inv_skew_bps_at_max: 0,
            ..Default::default()
        };
        let at_cap = p.quotes(100.0, 100.0, 0.0).spread_bps;
        let beyond_cap = p.quotes(100.0, 200.0, 0.0).spread_bps;
        assert!(approx(at_cap, beyond_cap, 1e-9), "penalty must saturate");
    }

    #[test]
    fn negative_vol_input_is_clamped() {
        let p = StrategyParams::default();
        let q = p.quotes(100.0, 0.0, -1.0);
        assert!(q.spread_bps >= p.base_spread_bps as f64);
    }
}
