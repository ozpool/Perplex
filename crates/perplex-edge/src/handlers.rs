//! Endpoint implementations. Each function maps 1-1 to a section of api-contract.md.
//! Numeric values cross the wire as decimal strings (never floats) per section 0 of the contract.

use axum::extract::{Path, Query, State};
use axum::Json;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::auth::{issue_jwt, verify_siwe, AuthedUser};
use crate::error::ApiError;
use crate::state::{now_ns, AppState};
use crate::types::*;

const MAX_TRADES: usize = 1000;
const MAX_FILLS: usize = 1000;

// -- 1.1 GET /v1/markets ------------------------------------------------------

#[utoipa::path(get, path = "/v1/markets", responses((status = 200, body = MarketsResponse)))]
pub async fn list_markets(
    State(state): State<AppState>,
) -> Result<Json<MarketsResponse>, ApiError> {
    Ok(Json(MarketsResponse {
        markets: state.list_markets(),
    }))
}

// -- 1.2 GET /v1/orderbook/{marketId} -----------------------------------------

#[derive(Debug, Deserialize)]
pub struct OrderbookQuery {
    /// Optional level cap; ignored when "full".
    depth: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/orderbook/{marketId}",
    params(("marketId" = String, Path, description = "Market id, e.g. btc-usd")),
    responses((status = 200, body = OrderbookSnapshot))
)]
pub async fn get_orderbook(
    State(state): State<AppState>,
    Path(market_id): Path<String>,
    Query(q): Query<OrderbookQuery>,
) -> Result<Json<OrderbookSnapshot>, ApiError> {
    if state.market(&market_id).is_none() {
        return Err(ApiError::NotFound);
    }
    let snap = state.orderbook(&market_id).unwrap_or_default();
    let depth = match q.depth.as_deref() {
        Some("full") | None => usize::MAX,
        Some("50") => 50,
        Some("200") => 200,
        Some(other) => other.parse::<usize>().unwrap_or(50),
    };
    let trim = |levels: Vec<[String; 2]>| levels.into_iter().take(depth).collect::<Vec<_>>();
    Ok(Json(OrderbookSnapshot {
        market_id,
        sequence: snap.sequence,
        bids: trim(snap.bids),
        asks: trim(snap.asks),
        ts_ns: now_ns().to_string(),
    }))
}

// -- 1.3 GET /v1/trades/{marketId} --------------------------------------------

#[derive(Debug, Deserialize)]
pub struct TradesQuery {
    limit: Option<usize>,
    before: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/trades/{marketId}",
    params(("marketId" = String, Path, description = "Market id")),
    responses((status = 200, body = TradesResponse))
)]
pub async fn get_trades(
    State(state): State<AppState>,
    Path(market_id): Path<String>,
    Query(q): Query<TradesQuery>,
) -> Result<Json<TradesResponse>, ApiError> {
    if state.market(&market_id).is_none() {
        return Err(ApiError::NotFound);
    }
    let limit = q.limit.unwrap_or(100).min(MAX_TRADES);
    let mut trades = state.public_trades(&market_id, limit);
    if let Some(before) = q.before {
        trades.retain(|t| t.ts_ns < before);
    }
    let next_before = trades.last().map(|t| t.ts_ns.clone());
    Ok(Json(TradesResponse {
        trades,
        next_before,
    }))
}

// -- 1.4 GET /v1/funding/{marketId} -------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FundingQuery {
    range: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/funding/{marketId}",
    params(("marketId" = String, Path, description = "Market id")),
    responses((status = 200, body = FundingResponse))
)]
pub async fn get_funding(
    State(state): State<AppState>,
    Path(market_id): Path<String>,
    Query(q): Query<FundingQuery>,
) -> Result<Json<FundingResponse>, ApiError> {
    if state.market(&market_id).is_none() {
        return Err(ApiError::NotFound);
    }
    let window_ns: u64 = match q.range.as_deref() {
        Some("1h") => 3_600 * 1_000_000_000,
        Some("7d") => 7 * 86_400 * 1_000_000_000,
        _ => 24 * 3_600 * 1_000_000_000,
    };
    let cutoff = now_ns().saturating_sub(window_ns);
    let history: Vec<_> = state
        .funding_history(&market_id)
        .into_iter()
        .filter(|(t, _)| *t >= cutoff)
        .map(|(t, r)| FundingHistoryPoint {
            ts_ns: t.to_string(),
            rate_bps: r,
        })
        .collect();
    let current = history.last().map(|p| p.rate_bps).unwrap_or(0.0);
    Ok(Json(FundingResponse {
        market_id,
        current_rate_bps: current,
        next_settlement_ts_ns: (now_ns() + 8 * 3600 * 1_000_000_000).to_string(),
        history,
    }))
}

// -- 1.5 POST /v1/orders ------------------------------------------------------

#[utoipa::path(
    post,
    path = "/v1/orders",
    request_body = PlaceOrderRequest,
    responses(
        (status = 200, body = PlaceOrderResponse),
        (status = 400, description = "validation failure"),
        (status = 401, description = "auth failure")
    )
)]
pub async fn place_order(
    State(state): State<AppState>,
    user: AuthedUser,
    Json(req): Json<PlaceOrderRequest>,
) -> Result<Json<PlaceOrderResponse>, ApiError> {
    if state.market(&req.market_id).is_none() {
        return Err(ApiError::MarketInactive);
    }
    if req.side != "buy" && req.side != "sell" {
        return Err(ApiError::BadRequest("side must be buy or sell".into()));
    }
    if req.order_type != "limit" && req.order_type != "market" {
        return Err(ApiError::BadRequest("type must be limit or market".into()));
    }
    if !matches!(req.time_in_force.as_str(), "gtc" | "ioc" | "fok") {
        return Err(ApiError::BadRequest("invalid timeInForce".into()));
    }
    if !req.signature.starts_with("0x") || req.signature.len() < 132 {
        return Err(ApiError::InvalidSignature);
    }
    let limit_price = if req.order_type == "limit" {
        Some(
            req.price
                .clone()
                .ok_or_else(|| ApiError::BadRequest("limit requires price".into()))?,
        )
    } else {
        None
    };

    let taker_qty: Decimal = req
        .qty
        .parse()
        .map_err(|_| ApiError::BadRequest("invalid qty".into()))?;
    if taker_qty.is_zero() {
        return Err(ApiError::BadRequest("qty must be > 0".into()));
    }
    let taker_price: Option<Decimal> = match &limit_price {
        Some(p) => Some(
            p.parse()
                .map_err(|_| ApiError::BadRequest("invalid price".into()))?,
        ),
        None => None,
    };

    let order_id = format!("ord_{}", ulid::Ulid::new());
    let ts_ns = now_ns().to_string();

    // Cross against the resting book. Maker orders are decremented in place and
    // the public orderbook snapshot is rebuilt by `match_taker`.
    let matches = state.match_taker(&req.market_id, &req.side, taker_price, taker_qty);
    let filled_qty: Decimal = matches.iter().map(|m| m.qty).sum();
    let taker_remaining = taker_qty - filled_qty;
    let taker_side = req.side.clone();
    let maker_side = if taker_side == "buy" { "sell" } else { "buy" };

    for m in &matches {
        let price_str = m.price.normalize().to_string();
        let qty_str = m.qty.normalize().to_string();
        let ts_str = m.ts_ns.to_string();

        state.record_fill(
            &user.address,
            FillInfo {
                id: format!("fil_{}", ulid::Ulid::new()),
                order_id: order_id.clone(),
                market_id: req.market_id.clone(),
                side: taker_side.clone(),
                price: price_str.clone(),
                qty: qty_str.clone(),
                fee_usdc: "0".into(),
                role: "taker".into(),
                ts_ns: ts_str.clone(),
                tx_hash: String::new(),
            },
        );
        state.record_fill(
            &m.maker_address,
            FillInfo {
                id: format!("fil_{}", ulid::Ulid::new()),
                order_id: m.maker_order_id.clone(),
                market_id: req.market_id.clone(),
                side: maker_side.to_string(),
                price: price_str.clone(),
                qty: qty_str.clone(),
                fee_usdc: "0".into(),
                role: "maker".into(),
                ts_ns: ts_str.clone(),
                tx_hash: String::new(),
            },
        );
        state.record_trade(
            &req.market_id,
            PublicTrade {
                id: format!("trd_{}", ulid::Ulid::new()),
                market_id: req.market_id.clone(),
                price: price_str,
                qty: qty_str,
                side: taker_side.clone(),
                ts_ns: ts_str,
            },
        );

        state.upsert_position(&user.address, &req.market_id, &taker_side, m.qty, m.price);
        state.upsert_position(&m.maker_address, &req.market_id, maker_side, m.qty, m.price);
    }

    // Rest leftover liquidity for limit orders only. Market orders with a
    // remainder are dropped (no resting at price 0).
    if !taker_remaining.is_zero() && req.order_type == "limit" {
        let price = limit_price.clone().unwrap_or_else(|| "0".to_string());
        state.add_open_order(
            &user.address,
            OpenOrder {
                id: order_id.clone(),
                market_id: req.market_id.clone(),
                side: req.side.clone(),
                order_type: req.order_type.clone(),
                price,
                qty: req.qty.clone(),
                remaining: taker_remaining.normalize().to_string(),
                ts_ns: ts_ns.clone(),
                client_order_id: req.client_order_id.clone(),
            },
        );
    }

    let status = if !matches.is_empty() && taker_remaining.is_zero() {
        "filled"
    } else if !matches.is_empty() {
        "partial"
    } else {
        "accepted"
    };

    Ok(Json(PlaceOrderResponse {
        order_id,
        status: status.into(),
        ts_ns,
    }))
}

// -- 1.6 DELETE /v1/orders/{orderId} ------------------------------------------

#[utoipa::path(
    delete,
    path = "/v1/orders/{orderId}",
    params(("orderId" = String, Path, description = "Order id")),
    responses((status = 200, body = CancelOrderResponse))
)]
pub async fn cancel_order(
    State(state): State<AppState>,
    user: AuthedUser,
    Path(order_id): Path<String>,
) -> Result<Json<CancelOrderResponse>, ApiError> {
    // Idempotent: re-cancel returns 200 with status "cancelled" regardless of prior state.
    let _ = state.cancel_order(&user.address, &order_id);
    Ok(Json(CancelOrderResponse {
        order_id,
        status: "cancelled".into(),
    }))
}

// -- 1.7 GET /v1/orders/open --------------------------------------------------

#[utoipa::path(get, path = "/v1/orders/open", responses((status = 200, body = OpenOrdersResponse)))]
pub async fn list_open_orders(
    State(state): State<AppState>,
    user: AuthedUser,
) -> Result<Json<OpenOrdersResponse>, ApiError> {
    Ok(Json(OpenOrdersResponse {
        orders: state.open_orders_for(&user.address),
    }))
}

// -- 1.8 GET /v1/positions ----------------------------------------------------

#[utoipa::path(get, path = "/v1/positions", responses((status = 200, body = PositionsResponse)))]
pub async fn list_positions(
    State(state): State<AppState>,
    user: AuthedUser,
) -> Result<Json<PositionsResponse>, ApiError> {
    let positions = state.positions_for(&user.address);
    let collateral = state.vault_balance(&user.address);
    Ok(Json(PositionsResponse {
        collateral_usdc: collateral.clone(),
        free_collateral_usdc: collateral,
        total_unrealised_pnl_usdc: "0".into(),
        total_notional_usdc: "0".into(),
        positions,
    }))
}

// -- 1.9 GET /v1/fills --------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FillsQuery {
    #[serde(rename = "marketId")]
    market_id: Option<String>,
    limit: Option<usize>,
    before: Option<String>,
}

#[utoipa::path(get, path = "/v1/fills", responses((status = 200, body = FillsResponse)))]
pub async fn list_fills(
    State(state): State<AppState>,
    user: AuthedUser,
    Query(q): Query<FillsQuery>,
) -> Result<Json<FillsResponse>, ApiError> {
    let limit = q.limit.unwrap_or(100).min(MAX_FILLS);
    let mut fills = state.fills_for(&user.address, limit);
    if let Some(mid) = q.market_id {
        fills.retain(|f| f.market_id == mid);
    }
    if let Some(before) = q.before {
        fills.retain(|f| f.ts_ns < before);
    }
    let next_before = fills.last().map(|f| f.ts_ns.clone());
    Ok(Json(FillsResponse { fills, next_before }))
}

// -- 1.10 SIWE flow -----------------------------------------------------------

#[utoipa::path(post, path = "/v1/auth/siwe/nonce", request_body = SiweNonceRequest, responses((status = 200, body = SiweNonceResponse)))]
pub async fn siwe_nonce(
    State(state): State<AppState>,
    Json(req): Json<SiweNonceRequest>,
) -> Result<Json<SiweNonceResponse>, ApiError> {
    if !req.address.starts_with("0x") || req.address.len() != 42 {
        return Err(ApiError::BadRequest("invalid address".into()));
    }
    let nonce = state.issue_siwe_nonce(&req.address);
    Ok(Json(SiweNonceResponse { nonce }))
}

#[utoipa::path(post, path = "/v1/auth/siwe/verify", request_body = SiweVerifyRequest, responses((status = 200, body = SiweVerifyResponse)))]
pub async fn siwe_verify(
    State(state): State<AppState>,
    Json(req): Json<SiweVerifyRequest>,
) -> Result<Json<SiweVerifyResponse>, ApiError> {
    let address = verify_siwe(&req.message, &req.signature, &state)?;
    let (jwt, exp_secs) = issue_jwt(state.jwt_secret(), &address)?;
    Ok(Json(SiweVerifyResponse {
        jwt,
        expires_at: (exp_secs as u128 * 1_000_000_000).to_string(),
    }))
}

// -- 1.11 GET /v1/account/balance ---------------------------------------------

#[utoipa::path(get, path = "/v1/account/balance", responses((status = 200, body = BalanceResponse)))]
pub async fn get_balance(
    State(state): State<AppState>,
    user: AuthedUser,
) -> Result<Json<BalanceResponse>, ApiError> {
    Ok(Json(BalanceResponse {
        vault_balance_usdc: state.vault_balance(&user.address),
        wallet_usdc_balance: "0".into(),
        pending_deposits: vec![],
        pending_withdrawals: vec![],
    }))
}

// -- dev helper: mint a JWT for `address` without going through SIWE. Returns the same JSON
//    shape as `/v1/auth/siwe/verify` so scripts can use a single parser for both. Exposed
//    only by `build_router_with_dev_token` (integration tests + local dev). Never wired into
//    the production router.
pub async fn dev_token(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<SiweVerifyResponse>, ApiError> {
    let (jwt, exp_secs) = issue_jwt(state.jwt_secret(), &address)?;
    Ok(Json(SiweVerifyResponse {
        jwt,
        expires_at: (exp_secs as u128 * 1_000_000_000).to_string(),
    }))
}
