//! Perplex edge API server.
//!
//! Implements the REST contract in `~/Desktop/perplex-fe/api-contract.md` (sections 1.1-1.11).
//! WebSocket lives in a follow-up PR. All endpoints are wired to `AppState`, which holds the
//! in-memory state stores for orders, positions, fills, and balances. In production the state
//! stores are backed by Postgres + Redis; here they are concrete types behind traits so unit
//! tests can swap them out trivially.

pub mod auth;
pub mod error;
pub mod handlers;
pub mod openapi;
pub mod oracle;
pub mod ratelimit;
pub mod router;
pub mod session;
pub mod state;
pub mod types;
pub mod ws;

pub use error::ApiError;
pub use router::{build_router, build_router_with_dev_token};
pub use state::AppState;

/// Alias used by integration tests so the dev-only token helper is obvious in test names.
pub use router::build_router_with_dev_token as build_router_with_dev_token_for_tests;
