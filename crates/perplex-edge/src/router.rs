use axum::routing::{delete, get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::handlers;
use crate::openapi::ApiDoc;
use crate::state::AppState;

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/v1/markets", get(handlers::list_markets))
        .route("/v1/orderbook/:market_id", get(handlers::get_orderbook))
        .route("/v1/trades/:market_id", get(handlers::get_trades))
        .route("/v1/funding/:market_id", get(handlers::get_funding))
        .route("/v1/orders", post(handlers::place_order))
        .route("/v1/orders/:order_id", delete(handlers::cancel_order))
        .route("/v1/orders/open", get(handlers::list_open_orders))
        .route("/v1/positions", get(handlers::list_positions))
        .route("/v1/fills", get(handlers::list_fills))
        .route("/v1/auth/siwe/nonce", post(handlers::siwe_nonce))
        .route("/v1/auth/siwe/verify", post(handlers::siwe_verify))
        .route("/v1/account/balance", get(handlers::get_balance))
        .merge(SwaggerUi::new("/docs").url("/docs/openapi.json", ApiDoc::openapi()))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

/// Dev-only router that exposes a `GET /__dev/token/:address` helper for E2E tests so they
/// don't need to round-trip a real wallet signature.
pub fn build_router_with_dev_token(state: AppState) -> Router {
    Router::new()
        .route("/__dev/token/:address", get(handlers::dev_token))
        .with_state(state.clone())
        .merge(build_router(state))
}
