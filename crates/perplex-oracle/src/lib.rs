//! Off-chain oracle source + relayer.
//!
//! Two sources implement the `PriceSource` trait:
//!   - `Hermes`  — Pyth's public Hermes REST endpoint (production)
//!   - `Mock`    — local in-memory or HTTP stub (devnet / tests)
//!
//! The `Relayer` polls a source on a cadence, compares against a last-published
//! price, and on drift past a threshold invokes a submit callback (Phase 4b wires
//! the alloy on-chain submission; this PR keeps that as a trait so the relayer
//! itself stays runtime-agnostic).

pub mod error;
pub mod relayer;
pub mod source;

pub use error::OracleError;
pub use relayer::{Relayer, RelayerConfig, Submitter};
pub use source::{HermesSource, MockSource, PriceSample, PriceSource};
