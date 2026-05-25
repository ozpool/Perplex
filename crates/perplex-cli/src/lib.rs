//! Perplex CLI — operator-facing tooling for the off-chain stack. The first sub-command is
//! `quote`, the synthetic-counterparty maker agent introduced in Phase 7. It owns a Redis
//! lease per market (single-writer guarantee), polls the edge for the index price, and
//! posts symmetric bid/ask quotes at a configurable spread.
//!
//! Strategy is intentionally minimal in this iteration — base-spread only, fixed size.
//! Phase 7's follow-up issue (#44) layers the inventory penalty, realised-vol multiplier,
//! and per-market kill switches on top of the same loop.

pub mod edge;
pub mod oracle;
pub mod quote;

pub use edge::{EdgeClient, HttpEdgeClient, PlaceOrderRequest};
pub use oracle::{EdgeMarketsOracle, OracleSource};
pub use quote::{acquire_market_lease, run_quote_agent, QuoteAgentConfig, QuoteStrategy};
