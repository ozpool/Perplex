//! Shared REST and WebSocket request/response types.
//! Frontend and edge both import these — single source of truth.
//! Stays in sync with ~/Desktop/perplex-fe/api-contract.md.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::types::{MarketParams, Side};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketView {
    pub id: String,
    pub base: String,
    pub quote: String,
    pub active: bool,
    pub tick_size: Decimal,
    pub lot_size: Decimal,
    pub max_leverage: u32,
    #[serde(flatten)]
    pub params: MarketParams,
    pub funding_interval_sec: u64,
    pub index_price_x18: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewOrderType {
    Market,
    Limit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewOrderTif {
    Gtc,
    Ioc,
    Fok,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewOrderReq {
    pub market_id: String,
    pub side: Side,
    #[serde(rename = "type")]
    pub order_type: NewOrderType,
    pub price: Decimal,
    pub qty: Decimal,
    pub time_in_force: NewOrderTif,
    pub reduce_only: bool,
    pub post_only: bool,
    pub client_order_id: Option<String>,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResp {
    pub order_id: String,
    pub status: String,
    pub ts_ns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorBody {
    pub error: ApiErrorInner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorInner {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Snapshot {
        channel: String,
        sequence: u64,
        bids: Vec<(Decimal, Decimal)>,
        asks: Vec<(Decimal, Decimal)>,
        ts_ns: String,
    },
    Delta {
        channel: String,
        sequence: u64,
        bids: Vec<(Decimal, Decimal)>,
        asks: Vec<(Decimal, Decimal)>,
        ts_ns: String,
    },
    Trade {
        channel: String,
        id: String,
        price: Decimal,
        qty: Decimal,
        side: Side,
        ts_ns: String,
    },
    Oracle {
        channel: String,
        price_x18: Decimal,
        confidence_x18: Decimal,
        source_ts_ns: String,
        ts_ns: String,
    },
    Funding {
        channel: String,
        current_rate_bps: Decimal,
        next_settlement_ts_ns: String,
        ts_ns: String,
    },
    Ping {
        ts_ns: String,
    },
}
