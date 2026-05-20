//! Stream writers for fills and order-book deltas.
//!
//! The matching engine produces two event streams per market:
//!   - `fills:{marketId}`     — each Fill emitted by a cross
//!   - `orderbook:{marketId}` — book-state deltas (level diffs)
//!
//! Consumers:
//!   - Settlement publisher (`fills:*`, ack-on-mined consumer group)
//!   - WebSocket fan-out      (`orderbook:*`, broadcast)
//!
//! This module defines async traits and ships a Redis Streams implementation plus a
//! `Memory` implementation for tests.

use std::collections::VecDeque;
use std::sync::Mutex;

use async_trait::async_trait;
use perplex_core::types::MarketId;
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::book::Side;
use crate::fill::Fill;

/// Per-market book delta. Each entry mutates one price level; qty == 0 means delete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BookDelta {
    pub market: MarketId,
    pub sequence: u64,
    pub side: Side,
    pub price: Decimal,
    pub qty: Decimal,
    pub ts_ns: u64,
}

#[derive(thiserror::Error, Debug)]
pub enum StreamError {
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

#[async_trait]
pub trait FillStream: Send + Sync {
    async fn append_fill(&self, fill: &Fill) -> Result<(), StreamError>;
}

#[async_trait]
pub trait BookDeltaStream: Send + Sync {
    async fn append_delta(&self, delta: &BookDelta) -> Result<(), StreamError>;
}

// -- Redis impl -----------------------------------------------------------

pub struct RedisStreamWriter {
    client: redis::Client,
}

impl RedisStreamWriter {
    pub fn new(url: &str) -> Result<Self, StreamError> {
        Ok(Self {
            client: redis::Client::open(url)?,
        })
    }
}

#[async_trait]
impl FillStream for RedisStreamWriter {
    async fn append_fill(&self, fill: &Fill) -> Result<(), StreamError> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("fills:{}", hex_market(&fill.market));
        let json = serde_json::to_string(fill)?;
        let _: String = con.xadd(key, "*", &[("payload", json.as_str())]).await?;
        Ok(())
    }
}

#[async_trait]
impl BookDeltaStream for RedisStreamWriter {
    async fn append_delta(&self, delta: &BookDelta) -> Result<(), StreamError> {
        let mut con = self.client.get_multiplexed_async_connection().await?;
        let key = format!("orderbook:{}", hex_market(&delta.market));
        let json = serde_json::to_string(delta)?;
        let _: String = con.xadd(key, "*", &[("payload", json.as_str())]).await?;
        Ok(())
    }
}

fn hex_market(m: &MarketId) -> String {
    let mut s = String::with_capacity(64);
    for b in m {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

// -- Memory impl (tests) --------------------------------------------------

/// Drop-in in-memory writer. Implements both stream traits so a single instance can
/// be wired into the dispatcher's fill and delta sinks in tests.
#[derive(Default)]
pub struct MemoryStream {
    fills: Mutex<VecDeque<Fill>>,
    deltas: Mutex<VecDeque<BookDelta>>,
}

impl MemoryStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn drain_fills(&self) -> Vec<Fill> {
        self.fills.lock().unwrap().drain(..).collect()
    }

    pub fn drain_deltas(&self) -> Vec<BookDelta> {
        self.deltas.lock().unwrap().drain(..).collect()
    }

    pub fn fill_count(&self) -> usize {
        self.fills.lock().unwrap().len()
    }
}

#[async_trait]
impl FillStream for MemoryStream {
    async fn append_fill(&self, fill: &Fill) -> Result<(), StreamError> {
        self.fills.lock().unwrap().push_back(fill.clone());
        Ok(())
    }
}

#[async_trait]
impl BookDeltaStream for MemoryStream {
    async fn append_delta(&self, delta: &BookDelta) -> Result<(), StreamError> {
        self.deltas.lock().unwrap().push_back(delta.clone());
        Ok(())
    }
}
