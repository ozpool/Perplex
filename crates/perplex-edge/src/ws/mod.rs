//! WebSocket server implementing api-contract.md section 2.
//!
//! Five channels:
//!   - `orderbook.{marketId}` (public, snapshot + delta)
//!   - `trades.{marketId}`    (public)
//!   - `oracle.{marketId}`    (public)
//!   - `user.fills`           (private — JWT bearer)
//!   - `user.positions`       (private — JWT bearer)
//!
//! Each subscriber is fed via a bounded mpsc (1000 slots). The hub drops the subscriber when
//! the channel is full — slow consumers do not back-pressure the publisher loop. Heartbeats
//! fire every 15s with a 30s pong timeout.

pub mod hub;
pub mod server;

pub use hub::{Hub, Message, Topic, MAX_QUEUE};
pub use server::{serve_ws, WsConfig};
