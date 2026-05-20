use std::cmp::Reverse;
use std::collections::{BTreeMap, VecDeque};

use perplex_core::types::{MarketId, OrderId};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::SubmitError;
use crate::fill::Fill;
use crate::order::{Order, OrderType, TimeInForce};
use crate::position_tracker::PositionTracker;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    pub fn opposite(self) -> Side {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }
}

/// Configurable self-trade prevention mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SelfTradeMode {
    /// Reject the taker; the maker stays on the book. Default — least disruptive.
    #[default]
    CancelNewest,
    /// Cancel both orders. Taker is rejected and the matched maker is removed.
    CancelBoth,
    /// Treat self-trades like any other fill (NOT recommended for prod; useful for tests).
    Allow,
}

#[derive(Debug, Default)]
pub struct Orderbook {
    market: MarketId,
    bids: BTreeMap<Reverse<Decimal>, VecDeque<Order>>, // descending by price
    asks: BTreeMap<Decimal, VecDeque<Order>>,          // ascending by price
    by_id: std::collections::HashMap<OrderId, Side>,
    next_fill_id: u64,
    self_trade: SelfTradeMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitOutcome {
    pub fills: Vec<Fill>,
    pub resting: Option<OrderId>, // some(id) if part of the order rests on the book
    pub remaining: Decimal,
}

impl Orderbook {
    pub fn new(market: MarketId) -> Self {
        Self {
            market,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            by_id: Default::default(),
            next_fill_id: 0,
            self_trade: SelfTradeMode::default(),
        }
    }

    pub fn with_self_trade(mut self, mode: SelfTradeMode) -> Self {
        self.self_trade = mode;
        self
    }

    pub fn market(&self) -> &MarketId {
        &self.market
    }

    pub fn best_bid(&self) -> Option<Decimal> {
        self.bids.keys().next().map(|k| k.0)
    }

    pub fn best_ask(&self) -> Option<Decimal> {
        self.asks.keys().next().copied()
    }

    /// Submit a taker order. Returns the list of fills produced and whether the order
    /// rests on the book afterwards. Reduce-only checks consult `tracker` (which should
    /// reflect the user's current net position before this fill).
    pub fn submit(
        &mut self,
        mut order: Order,
        tracker: &PositionTracker,
    ) -> Result<SubmitOutcome, SubmitError> {
        if order.qty <= Decimal::ZERO {
            return Err(SubmitError::ZeroQty);
        }
        if order.order_type == OrderType::Limit && order.price <= Decimal::ZERO {
            return Err(SubmitError::ZeroPrice);
        }
        order.remaining = order.qty;

        // Post-only: reject if it would cross at submission. Same-side: never crosses.
        if order.post_only {
            let would_cross = match order.side {
                Side::Buy => self.best_ask().map(|a| order.price >= a).unwrap_or(false),
                Side::Sell => self.best_bid().map(|b| order.price <= b).unwrap_or(false),
            };
            if would_cross {
                return Err(SubmitError::PostOnlyWouldCross);
            }
        }

        // Reduce-only: must strictly reduce net position. Computed against full order qty.
        if order.reduce_only
            && !tracker.would_reduce(&order.owner, &order.market, order.side, order.qty)
        {
            return Err(SubmitError::ReduceOnlyWouldIncrease);
        }

        // FOK: simulate to make sure the full qty crosses; if not, reject.
        if order.time_in_force == TimeInForce::Fok {
            let available = self.crossable_qty(&order);
            if available < order.qty {
                return Err(SubmitError::FokUnfillable);
            }
        }

        // Cross.
        let mut fills = Vec::new();
        match order.side {
            Side::Buy => self.cross_buy(&mut order, &mut fills)?,
            Side::Sell => self.cross_sell(&mut order, &mut fills)?,
        };

        // Market order with insufficient liquidity: error if anything remained unfilled.
        if order.order_type == OrderType::Market && order.remaining > Decimal::ZERO {
            return Err(SubmitError::MarketNoLiquidity);
        }

        let mut resting = None;

        // Limit + IOC unfilled remainder is cancelled (not rested).
        if order.remaining > Decimal::ZERO
            && order.order_type == OrderType::Limit
            && order.time_in_force == TimeInForce::Gtc
        {
            let id = order.id;
            self.rest(order.clone());
            resting = Some(id);
        }

        Ok(SubmitOutcome {
            fills,
            resting,
            remaining: order.remaining,
        })
    }

    /// Cancel an order by id. Returns true if removed.
    pub fn cancel(&mut self, id: OrderId) -> bool {
        let Some(side) = self.by_id.remove(&id) else {
            return false;
        };
        match side {
            Side::Buy => Self::remove_from_side(&mut self.bids, id),
            Side::Sell => Self::remove_from_side_asc(&mut self.asks, id),
        }
    }

    /// Total qty resting on the book that the taker would cross at current prices.
    pub fn crossable_qty(&self, taker: &Order) -> Decimal {
        let mut total = Decimal::ZERO;
        match taker.side {
            Side::Buy => {
                for (price, q) in self.asks.iter() {
                    if !taker.crosses(*price) {
                        break;
                    }
                    for o in q {
                        total += o.remaining;
                    }
                }
            }
            Side::Sell => {
                for (price, q) in self.bids.iter() {
                    let p = price.0;
                    if !taker.crosses(p) {
                        break;
                    }
                    for o in q {
                        total += o.remaining;
                    }
                }
            }
        }
        total
    }

    // -- internals ------------------------------------------------------------

    fn cross_buy(&mut self, taker: &mut Order, fills: &mut Vec<Fill>) -> Result<(), SubmitError> {
        loop {
            if taker.remaining <= Decimal::ZERO {
                return Ok(());
            }
            let Some((&ask_price, _)) = self.asks.iter().next() else {
                return Ok(());
            };
            if !taker.crosses(ask_price) {
                return Ok(());
            }
            self.cross_one_level(taker, fills, ask_price, Side::Sell)?;
            if self
                .asks
                .get(&ask_price)
                .map(|q| q.is_empty())
                .unwrap_or(false)
            {
                self.asks.remove(&ask_price);
            }
        }
    }

    fn cross_sell(&mut self, taker: &mut Order, fills: &mut Vec<Fill>) -> Result<(), SubmitError> {
        loop {
            if taker.remaining <= Decimal::ZERO {
                return Ok(());
            }
            let Some((&Reverse(bid_price), _)) = self.bids.iter().next() else {
                return Ok(());
            };
            if !taker.crosses(bid_price) {
                return Ok(());
            }
            self.cross_one_level(taker, fills, bid_price, Side::Buy)?;
            if self
                .bids
                .get(&Reverse(bid_price))
                .map(|q| q.is_empty())
                .unwrap_or(false)
            {
                self.bids.remove(&Reverse(bid_price));
            }
        }
    }

    fn cross_one_level(
        &mut self,
        taker: &mut Order,
        fills: &mut Vec<Fill>,
        level_price: Decimal,
        maker_side: Side,
    ) -> Result<(), SubmitError> {
        let queue: &mut VecDeque<Order> = match maker_side {
            Side::Buy => self
                .bids
                .get_mut(&Reverse(level_price))
                .expect("queue exists"),
            Side::Sell => self.asks.get_mut(&level_price).expect("queue exists"),
        };

        let mut consumed_indices: Vec<usize> = Vec::new();
        let mut iter_idx = 0usize;

        while taker.remaining > Decimal::ZERO {
            let Some(maker) = queue.get_mut(iter_idx) else {
                break;
            };

            // Self-trade prevention.
            if maker.owner == taker.owner {
                match self.self_trade {
                    SelfTradeMode::Allow => {
                        // proceed
                    }
                    SelfTradeMode::CancelNewest => {
                        // remove from id map and stop; caller will see no fills produced
                        // against this maker. Taker is rejected with SelfTradeRejected so
                        // the engine can surface it back to the user.
                        return Err(SubmitError::SelfTradeRejected);
                    }
                    SelfTradeMode::CancelBoth => {
                        consumed_indices.push(iter_idx);
                        self.by_id.remove(&maker.id);
                        iter_idx += 1;
                        continue;
                    }
                }
            }

            let traded = taker.remaining.min(maker.remaining);
            maker.remaining -= traded;
            taker.remaining -= traded;

            self.next_fill_id += 1;
            fills.push(Fill {
                id: self.next_fill_id,
                market: self.market,
                maker_order_id: maker.id,
                taker_order_id: taker.id,
                maker_user: maker.owner,
                taker_user: taker.owner,
                price: level_price,
                qty: traded,
                taker_side: taker.side,
                ts_ns: taker.ts_ns,
            });

            if maker.remaining == Decimal::ZERO {
                self.by_id.remove(&maker.id);
                consumed_indices.push(iter_idx);
                iter_idx += 1;
            } else {
                // Maker still has qty; we hit our limit on taker side and stop here.
                break;
            }
        }

        // Compact: remove fully-consumed makers from the front of the queue.
        // consumed_indices is in ascending order; pop from the back to avoid index drift.
        for &i in consumed_indices.iter().rev() {
            queue.remove(i);
        }
        Ok(())
    }

    fn rest(&mut self, order: Order) {
        self.by_id.insert(order.id, order.side);
        match order.side {
            Side::Buy => {
                self.bids
                    .entry(Reverse(order.price))
                    .or_default()
                    .push_back(order);
            }
            Side::Sell => {
                self.asks.entry(order.price).or_default().push_back(order);
            }
        }
    }

    fn remove_from_side(
        map: &mut BTreeMap<Reverse<Decimal>, VecDeque<Order>>,
        id: OrderId,
    ) -> bool {
        let mut found_key: Option<Reverse<Decimal>> = None;
        for (k, q) in map.iter_mut() {
            if let Some(pos) = q.iter().position(|o| o.id == id) {
                q.remove(pos);
                if q.is_empty() {
                    found_key = Some(*k);
                }
                if found_key.is_some() {
                    break;
                }
                return true;
            }
        }
        if let Some(k) = found_key {
            map.remove(&k);
        }
        true
    }

    fn remove_from_side_asc(map: &mut BTreeMap<Decimal, VecDeque<Order>>, id: OrderId) -> bool {
        let mut found_key: Option<Decimal> = None;
        for (k, q) in map.iter_mut() {
            if let Some(pos) = q.iter().position(|o| o.id == id) {
                q.remove(pos);
                if q.is_empty() {
                    found_key = Some(*k);
                }
                if found_key.is_some() {
                    break;
                }
                return true;
            }
        }
        if let Some(k) = found_key {
            map.remove(&k);
        }
        true
    }
}
