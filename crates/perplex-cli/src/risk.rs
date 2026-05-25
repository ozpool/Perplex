//! Risk feed: per-market signed inventory and realised PnL. The default impl polls the
//! edge's `/v1/positions` endpoint, which already enriches on-chain state with PositionInfo
//! per market. Trait-driven so tests inject deterministic snapshots.

use async_trait::async_trait;
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, Default)]
pub struct MarketRisk {
    /// Signed inventory in base-asset units (positive = long).
    pub inventory: f64,
    /// Realised PnL in USDC (signed). Negative drives the kill switch.
    pub realised_pnl_usdc: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum RiskError {
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("parse field `{field}`: {raw}")]
    Parse { field: &'static str, raw: String },
}

#[async_trait]
pub trait RiskSource: Send + Sync {
    async fn fetch(&self, market_id: &str) -> Result<MarketRisk, RiskError>;
}

#[derive(Clone)]
pub struct EdgeRiskSource {
    base_url: String,
    bearer: String,
    http: reqwest::Client,
}

impl EdgeRiskSource {
    pub fn new(base_url: impl Into<String>, bearer: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            bearer: bearer.into(),
            http: reqwest::Client::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct PositionsResponse {
    positions: Vec<PositionInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PositionInfo {
    market_id: String,
    size: String,
    /// "long" or "short".
    side: String,
    realised_pnl_usdc: String,
}

#[async_trait]
impl RiskSource for EdgeRiskSource {
    async fn fetch(&self, market_id: &str) -> Result<MarketRisk, RiskError> {
        let url = format!("{}/v1/positions", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.bearer)
            .send()
            .await?
            .error_for_status()?;
        let parsed: PositionsResponse = resp.json().await?;
        let Some(p) = parsed
            .positions
            .into_iter()
            .find(|p| p.market_id == market_id)
        else {
            return Ok(MarketRisk::default());
        };
        let size = f64::from_str(&p.size).map_err(|_| RiskError::Parse {
            field: "size",
            raw: p.size.clone(),
        })?;
        let inventory = match p.side.as_str() {
            "long" => size.abs(),
            "short" => -size.abs(),
            _ => size,
        };
        let realised_pnl_usdc =
            f64::from_str(&p.realised_pnl_usdc).map_err(|_| RiskError::Parse {
                field: "realisedPnlUsdc",
                raw: p.realised_pnl_usdc.clone(),
            })?;
        Ok(MarketRisk {
            inventory,
            realised_pnl_usdc,
        })
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    #[derive(Clone)]
    pub(crate) struct MockRiskSource {
        snapshots: Arc<StdMutex<HashMap<String, MarketRisk>>>,
    }

    impl MockRiskSource {
        pub fn new(seed: &[(&str, MarketRisk)]) -> Self {
            let map = seed.iter().map(|(k, v)| ((*k).to_string(), *v)).collect();
            Self {
                snapshots: Arc::new(StdMutex::new(map)),
            }
        }

        pub fn set(&self, market: &str, risk: MarketRisk) {
            self.snapshots
                .lock()
                .unwrap()
                .insert(market.to_string(), risk);
        }
    }

    #[async_trait]
    impl RiskSource for MockRiskSource {
        async fn fetch(&self, market_id: &str) -> Result<MarketRisk, RiskError> {
            Ok(self
                .snapshots
                .lock()
                .unwrap()
                .get(market_id)
                .copied()
                .unwrap_or_default())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::MockRiskSource;
    use super::*;

    #[tokio::test]
    async fn mock_returns_seeded_value() {
        let m = MockRiskSource::new(&[(
            "btc-usd",
            MarketRisk {
                inventory: 5.0,
                realised_pnl_usdc: -100.0,
            },
        )]);
        let r = m.fetch("btc-usd").await.unwrap();
        assert_eq!(r.inventory, 5.0);
        assert_eq!(r.realised_pnl_usdc, -100.0);
    }

    #[tokio::test]
    async fn mock_returns_default_for_unknown_market() {
        let m = MockRiskSource::new(&[]);
        let r = m.fetch("eth-usd").await.unwrap();
        assert_eq!(r.inventory, 0.0);
        assert_eq!(r.realised_pnl_usdc, 0.0);
    }
}
