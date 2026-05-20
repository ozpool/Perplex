use perplex_core::types::{Address, MarketId, OrderId, TsNanos};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fill {
    pub id: u64,
    pub market: MarketId,
    pub maker_order_id: OrderId,
    pub taker_order_id: OrderId,
    pub maker_user: Address,
    pub taker_user: Address,
    pub price: Decimal,
    pub qty: Decimal,
    /// Taker side. Maker side is the opposite by construction.
    pub taker_side: crate::book::Side,
    pub ts_ns: TsNanos,
}
