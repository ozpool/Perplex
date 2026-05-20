use perplex_core::types::{Address, MarketId, OrderId, TsNanos};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::book::Side;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderType {
    Market,
    Limit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeInForce {
    /// Good-till-cancelled (default for limits).
    Gtc,
    /// Immediate-or-cancel: cross what's available now, cancel any unfilled remainder.
    Ioc,
    /// Fill-or-kill: cross the FULL qty atomically or reject entirely.
    Fok,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: OrderId,
    pub owner: Address,
    pub market: MarketId,
    pub side: Side,
    pub order_type: OrderType,
    /// For market orders this is ignored; we still keep it so a market order can carry
    /// a slippage cap if the caller wants one (encoded as a finite price).
    pub price: Decimal,
    pub qty: Decimal,
    pub remaining: Decimal,
    pub time_in_force: TimeInForce,
    pub post_only: bool,
    pub reduce_only: bool,
    pub ts_ns: TsNanos,
}

impl Order {
    /// True if `self` (a taker) would cross `maker_price`.
    pub fn crosses(&self, maker_price: Decimal) -> bool {
        match (self.side, self.order_type) {
            (Side::Buy, OrderType::Market) => true,
            (Side::Sell, OrderType::Market) => true,
            (Side::Buy, OrderType::Limit) => self.price >= maker_price,
            (Side::Sell, OrderType::Limit) => self.price <= maker_price,
        }
    }
}
