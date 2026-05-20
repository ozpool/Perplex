use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub type Price = Decimal;
pub type Qty = Decimal;
pub type Address = [u8; 20];
pub type MarketId = [u8; 32];
pub type OrderId = u64;
pub type FillId = u64;
pub type TsNanos = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderType {
    Market,
    Limit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeInForce {
    Gtc,
    Ioc,
    Fok,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: OrderId,
    pub owner: Address,
    pub market: MarketId,
    pub side: Side,
    pub order_type: OrderType,
    pub price: Price,
    pub qty: Qty,
    pub remaining: Qty,
    pub time_in_force: TimeInForce,
    pub reduce_only: bool,
    pub post_only: bool,
    pub nonce: u64,
    pub ts_ns: TsNanos,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fill {
    pub id: FillId,
    pub maker_order_id: OrderId,
    pub taker_order_id: OrderId,
    pub market: MarketId,
    pub price: Price,
    pub qty: Qty,
    pub maker_user: Address,
    pub taker_user: Address,
    pub maker_fee: Decimal,
    pub taker_fee: Decimal,
    pub ts_ns: TsNanos,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub user: Address,
    pub market: MarketId,
    pub size: Decimal,
    pub entry_price: Price,
    pub cumulative_funding: Decimal,
    pub last_updated_ts_ns: TsNanos,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MarketParams {
    pub im_ratio_bps: u16,
    pub mm_ratio_bps: u16,
    pub liq_bonus_bps: u16,
    pub taker_fee_bps: u16,
    pub maker_rebate_bps: i16,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookDelta {
    pub market: MarketId,
    pub sequence: u64,
    pub bids: Vec<(Price, Qty)>,
    pub asks: Vec<(Price, Qty)>,
    pub ts_ns: TsNanos,
}
