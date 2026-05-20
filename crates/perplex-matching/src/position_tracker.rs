use std::collections::HashMap;

use perplex_core::types::{Address, MarketId};
use rust_decimal::Decimal;

use crate::book::Side;

/// Tracks net position per (user, market). Used by the matching engine for the
/// reduce-only flag and by tests for invariant checking. Source of truth in
/// production is on-chain PositionRegistry; this tracker is a local cache that
/// the dispatcher refreshes from settlement events.
#[derive(Debug, Default, Clone)]
pub struct PositionTracker {
    positions: HashMap<(Address, MarketId), Decimal>,
}

impl PositionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, user: &Address, market: &MarketId) -> Decimal {
        self.positions
            .get(&(*user, *market))
            .copied()
            .unwrap_or(Decimal::ZERO)
    }

    pub fn set(&mut self, user: Address, market: MarketId, size: Decimal) {
        if size.is_zero() {
            self.positions.remove(&(user, market));
        } else {
            self.positions.insert((user, market), size);
        }
    }

    pub fn apply_fill(&mut self, user: Address, market: MarketId, side: Side, qty: Decimal) {
        let cur = self.get(&user, &market);
        let delta = match side {
            Side::Buy => qty,
            Side::Sell => -qty,
        };
        self.set(user, market, cur + delta);
    }

    /// True if a taker fill of `qty` on `side` for `(user, market)` would strictly
    /// reduce the absolute value of the net position.
    pub fn would_reduce(
        &self,
        user: &Address,
        market: &MarketId,
        side: Side,
        qty: Decimal,
    ) -> bool {
        let cur = self.get(user, market);
        if cur.is_zero() {
            return false; // opening a new position is never "reduce-only safe"
        }
        match (cur.is_sign_positive(), side) {
            // long + sell  => reduces if qty <= |cur|
            (true, Side::Sell) => qty <= cur,
            // short + buy  => reduces if qty <= |cur|
            (false, Side::Buy) => qty <= -cur,
            _ => false,
        }
    }
}
