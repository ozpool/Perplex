//! Perplex CLI — operator-facing tooling for the off-chain stack. The first sub-command is
//! `quote`, the synthetic-counterparty maker agent introduced in Phase 7. It owns a Redis
//! lease per market (single-writer guarantee), polls the edge for the index price, fetches
//! per-market inventory and realised PnL, and posts symmetric bid/ask quotes whose width
//! and centre are derived from `crate::strategy`.

pub mod edge;
pub mod kill;
pub mod oracle;
pub mod quote;
pub mod risk;
pub mod strategy;
pub mod vol;

pub use edge::{EdgeClient, HttpEdgeClient, PlaceOrderRequest};
pub use kill::KillSwitch;
pub use oracle::{EdgeMarketsOracle, OracleSource};
pub use quote::{acquire_market_lease, run_quote_agent, QuoteAgentConfig};
pub use risk::{EdgeRiskSource, MarketRisk, RiskSource};
pub use strategy::{Quotes, StrategyParams};
pub use vol::VolWindow;
