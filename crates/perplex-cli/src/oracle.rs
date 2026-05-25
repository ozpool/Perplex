//! Oracle source for the quote agent. The default impl polls perplex-edge's `/v1/markets`
//! endpoint, which already aggregates the on-chain oracle. We keep this trait-driven so the
//! agent can run against deterministic mocks in tests.

use async_trait::async_trait;
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, thiserror::Error)]
pub enum OracleError {
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("market {0} not found in oracle response")]
    NotFound(String),
    #[error("price for {market} unparseable: {raw}")]
    Parse { market: String, raw: String },
}

#[async_trait]
pub trait OracleSource: Send + Sync {
    /// Return the latest mid price for `market_id` as a positive `f64`. The default impl
    /// scales `indexPriceX18` down by 1e18; mocks can return any unit so long as both the
    /// strategy and the assertions share it.
    async fn mid_price(&self, market_id: &str) -> Result<f64, OracleError>;
}

#[derive(Clone)]
pub struct EdgeMarketsOracle {
    base_url: String,
    http: reqwest::Client,
}

impl EdgeMarketsOracle {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            http: reqwest::Client::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct MarketsResponse {
    markets: Vec<EdgeMarket>,
}

#[derive(Debug, Deserialize)]
struct EdgeMarket {
    id: String,
    #[serde(rename = "indexPriceX18")]
    index_price_x18: String,
}

#[async_trait]
impl OracleSource for EdgeMarketsOracle {
    async fn mid_price(&self, market_id: &str) -> Result<f64, OracleError> {
        let url = format!("{}/v1/markets", self.base_url);
        let resp = self.http.get(&url).send().await?.error_for_status()?;
        let parsed: MarketsResponse = resp.json().await?;
        let market = parsed
            .markets
            .into_iter()
            .find(|m| m.id == market_id)
            .ok_or_else(|| OracleError::NotFound(market_id.into()))?;
        let raw = market.index_price_x18.clone();
        let x18 = u128::from_str(&raw).map_err(|_| OracleError::Parse {
            market: market_id.into(),
            raw: raw.clone(),
        })?;
        // f64 has ~15 decimal digits of mantissa, which is comfortably enough for an asset
        // price scaled to 1e18 — we accept the rounding because the strategy only needs the
        // result to tick precision.
        Ok((x18 as f64) / 1e18)
    }
}
