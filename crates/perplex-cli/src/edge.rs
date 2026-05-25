//! HTTP client for the perplex-edge REST API. Trait-driven so tests can stub it without
//! a live edge process.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum EdgeError {
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("non-success status {status}: {body}")]
    Status { status: u16, body: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct PlaceOrderRequest {
    #[serde(rename = "marketId")]
    pub market_id: String,
    /// "buy" or "sell".
    pub side: String,
    /// Always "limit" for the quote agent.
    #[serde(rename = "type")]
    pub order_type: String,
    pub price: Option<String>,
    pub qty: String,
    #[serde(rename = "timeInForce")]
    pub time_in_force: String,
    #[serde(rename = "reduceOnly")]
    pub reduce_only: bool,
    #[serde(rename = "postOnly")]
    pub post_only: bool,
    #[serde(rename = "clientOrderId")]
    pub client_order_id: Option<String>,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlaceOrderResponse {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[allow(dead_code)]
    pub status: String,
}

#[async_trait]
pub trait EdgeClient: Send + Sync {
    async fn place_order(&self, req: &PlaceOrderRequest) -> Result<String, EdgeError>;
    async fn cancel_order(&self, order_id: &str) -> Result<(), EdgeError>;
}

#[derive(Clone)]
pub struct HttpEdgeClient {
    base_url: String,
    bearer: String,
    http: reqwest::Client,
}

impl HttpEdgeClient {
    pub fn new(base_url: impl Into<String>, bearer: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            bearer: bearer.into(),
            http: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl EdgeClient for HttpEdgeClient {
    async fn place_order(&self, req: &PlaceOrderRequest) -> Result<String, EdgeError> {
        let url = format!("{}/v1/orders", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.bearer)
            .json(req)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(EdgeError::Status {
                status: status.as_u16(),
                body,
            });
        }
        let parsed: PlaceOrderResponse = resp.json().await?;
        Ok(parsed.order_id)
    }

    async fn cancel_order(&self, order_id: &str) -> Result<(), EdgeError> {
        let url = format!("{}/v1/orders/{}", self.base_url, order_id);
        let resp = self
            .http
            .delete(&url)
            .bearer_auth(&self.bearer)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(EdgeError::Status {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }
}
