//! Perplex orderbook matching engine.
//!
//! Single-threaded, no-lock orderbook per market. Price-time priority on the cross,
//! FIFO within a price level. All numeric quantities use `rust_decimal::Decimal` for
//! exact base-10 arithmetic; on-chain settlement converts to 1e18-scaled integers via
//! `perplex_core::margin`.
//!
//! Module layout:
//!   - `book`         Orderbook + Side + price-time priority cross logic
//!   - `order`        Order struct, time-in-force, post-only, reduce-only
//!   - `fill`         Fill produced by a cross
//!   - `error`        SubmitError + reasons
//!   - `position_tracker` (test helper) tracks net positions for reduce-only checks
//!
//! Phase 3 ships the in-process matching core. Phase 3b wires the per-market worker
//! dispatcher + Redis Streams writers; Phase 3c adds the criterion bench suite.

pub mod book;
pub mod dispatcher;
pub mod error;
pub mod fill;
pub mod order;
pub mod position_tracker;
pub mod stream;

pub use book::{Orderbook, Side};
pub use dispatcher::{Dispatcher, EngineCmd};
pub use error::SubmitError;
pub use fill::Fill;
pub use order::{Order, OrderType, TimeInForce};
pub use position_tracker::PositionTracker;
pub use stream::{
    BookDelta, BookDeltaStream, FillStream, MemoryStream, RedisStreamWriter, StreamError,
};
