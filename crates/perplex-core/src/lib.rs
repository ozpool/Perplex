//! perplex-core — shared types, traits, and math primitives used by every other crate.
//!
//! Layers:
//!   - `types`   strongly-typed Order, Fill, Position, Market structs
//!   - `margin`  Rust mirror of Solidity PositionRegistry math (used in REST pre-checks)
//!   - `eip712`  typed-data domain + struct encoding for Order and SessionKey
//!   - `api`     REST and WebSocket request/response contracts shared by edge + clients
//!
//! All decimal math uses `rust_decimal::Decimal` (28-digit fixed precision) on the hot path
//! and `alloy::primitives::U256` only when interacting with on-chain calldata.

pub mod api;
pub mod eip712;
pub mod margin;
pub mod types;

pub use types::*;
