use utoipa::OpenApi;

use crate::handlers;
use crate::types::*;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Perplex Edge API",
        version = "1.1",
        description = "REST surface for the Perplex perpetuals DEX. See api-contract.md for the full spec.",
    ),
    paths(
        handlers::list_markets,
        handlers::get_orderbook,
        handlers::get_trades,
        handlers::get_funding,
        handlers::place_order,
        handlers::cancel_order,
        handlers::list_open_orders,
        handlers::list_positions,
        handlers::list_fills,
        handlers::siwe_nonce,
        handlers::siwe_verify,
        handlers::get_balance,
    ),
    components(schemas(
        MarketInfo,
        MarketsResponse,
        OrderbookSnapshot,
        PublicTrade,
        TradesResponse,
        FundingHistoryPoint,
        FundingResponse,
        PlaceOrderRequest,
        PlaceOrderResponse,
        CancelOrderResponse,
        OpenOrder,
        OpenOrdersResponse,
        PositionInfo,
        PositionsResponse,
        FillInfo,
        FillsResponse,
        SiweNonceRequest,
        SiweNonceResponse,
        SiweVerifyRequest,
        SiweVerifyResponse,
        BalanceResponse,
    ))
)]
pub struct ApiDoc;

/// Convert the OpenAPI document into a Postman v2.1 collection. We walk the serialised JSON
/// rather than utoipa's typed model so we stay decoupled from upstream API churn.
pub fn openapi_to_postman(openapi: &utoipa::openapi::OpenApi) -> serde_json::Value {
    let doc = serde_json::to_value(openapi).expect("openapi serialises to JSON");
    let mut items = Vec::new();
    let methods = ["get", "post", "put", "delete", "patch", "head", "options"];
    if let Some(paths) = doc.get("paths").and_then(|p| p.as_object()) {
        for (path, item) in paths {
            for m in methods {
                if let Some(op) = item.get(m) {
                    let name = op
                        .get("summary")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("{} {}", m.to_uppercase(), path));
                    items.push(serde_json::json!({
                        "name": name,
                        "request": {
                            "method": m.to_uppercase(),
                            "header": [],
                            "url": {
                                "raw": format!("{{{{baseUrl}}}}{path}"),
                                "host": ["{{baseUrl}}"],
                                "path": path.trim_start_matches('/').split('/').collect::<Vec<_>>(),
                            },
                            "description": op.get("description").cloned(),
                        }
                    }));
                }
            }
        }
    }
    serde_json::json!({
        "info": {
            "name": "Perplex Edge API",
            "_postman_id": "perplex-edge",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "item": items,
        "variable": [{"key": "baseUrl", "value": "http://localhost:8080"}],
    })
}
