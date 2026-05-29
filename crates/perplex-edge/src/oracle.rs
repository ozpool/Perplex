//! Edge-side oracle relayer glue.
//!
//! Wraps `perplex_oracle::Relayer` with a Submitter that pushes fresh Pyth
//! prices into AppState (so REST + portfolio aggregates see them) and
//! broadcasts an `oracle.{marketId}` payload over the WS hub (so the
//! frontend's MarketHeader / Position / Portfolio tiles tick live).
//!
//! Production swaps Hermes for a private oracle source and points the
//! submitter at the on-chain adapter as well; nothing in this module is
//! protocol-critical.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use perplex_oracle::{HermesSource, OracleError, PriceSample, Relayer, RelayerConfig, Submitter};
use rust_decimal::Decimal;
use serde_json::json;
use tracing::{debug, info};

use crate::state::{now_ns, AppState};
use crate::ws::{Hub, Message, Topic};

/// One Pyth feed wired to one Perplex market.
#[derive(Debug, Clone)]
pub struct FeedBinding {
    pub market_id: String,
    pub feed_id: String,
}

/// Defaults: BTC/USD, ETH/USD, SOL/USD on Pyth mainnet feed ids. These ids
/// are stable across Pyth deployments and listed in their public registry.
/// Stored *without* a leading 0x because Hermes' `parsed[].id` returns the
/// hex without one — and `feed_to_market` lookups compare against that.
pub fn default_feeds() -> Vec<FeedBinding> {
    vec![
        FeedBinding {
            market_id: "btc-usd".into(),
            feed_id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43".into(),
        },
        FeedBinding {
            market_id: "eth-usd".into(),
            feed_id: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace".into(),
        },
        FeedBinding {
            market_id: "sol-usd".into(),
            feed_id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d".into(),
        },
    ]
}

struct EdgeSubmitter {
    state: AppState,
    hub: Hub,
    /// feed_id -> marketId. Two-way isn't needed because samples carry feed_id.
    feed_to_market: HashMap<String, String>,
}

#[async_trait]
impl Submitter for EdgeSubmitter {
    async fn submit(&self, samples: &[PriceSample]) -> Result<(), OracleError> {
        for s in samples {
            let Some(market_id) = self.feed_to_market.get(&s.feed_id) else {
                continue;
            };
            let price_x18 = scale_decimal_to_x18(s.price_x18);
            debug!(
                market = %market_id,
                price = %s.price_x18,
                price_x18 = %price_x18,
                "oracle submit"
            );
            self.state.set_oracle_price(market_id, price_x18.clone());

            // Fan out to subscribers of oracle.{marketId}. Confidence isn't
            // wired through PriceSample today (production would carry it);
            // surface zero so the FE schema stays satisfied.
            let payload = json!({
                "type": "oracle",
                "channel": format!("oracle.{}", market_id),
                "priceX18": price_x18,
                "confidenceX18": "0",
                "sourceTsNs": (s.publish_time_sec * 1_000_000_000).to_string(),
                "tsNs": now_ns().to_string(),
            });
            self.hub.publish(Message {
                topic: Topic::Oracle(market_id.clone()),
                payload,
            });
        }
        Ok(())
    }
}

/// Spawn the relayer on the current Tokio runtime. Returns immediately;
/// the task runs until the runtime shuts down or the source errors past
/// its retry budget. Failure here is non-fatal: the edge stays up and
/// REST keeps serving the seeded index price.
pub fn spawn_pyth_relayer(state: AppState, hub: Hub, feeds: Vec<FeedBinding>) {
    if feeds.is_empty() {
        info!("oracle relayer skipped: no feeds configured");
        return;
    }
    let feed_to_market: HashMap<String, String> = feeds
        .iter()
        .map(|f| (f.feed_id.clone(), f.market_id.clone()))
        .collect();
    let feed_ids: Vec<String> = feeds.iter().map(|f| f.feed_id.clone()).collect();
    let cfg = RelayerConfig {
        feeds: feed_ids,
        // 500ms is plenty for a live demo and well under Hermes rate budgets.
        poll_interval: Duration::from_millis(500),
        // 2 bps (0.02%) — tight enough to surface noticeable motion in BTC/ETH/SOL
        // without spamming the WS hub when the market is dead.
        drift_bps: 2,
        // Force a tick once a second so the FE never freezes when prices are flat.
        heartbeat: Duration::from_secs(1),
    };
    let source = Arc::new(HermesSource::mainnet());
    let submitter = Arc::new(EdgeSubmitter {
        state,
        hub,
        feed_to_market,
    });
    let relayer = Relayer::new(source, submitter, cfg);
    tokio::spawn(async move {
        match relayer.run().await {
            Ok(()) => info!("oracle relayer exited cleanly"),
            Err(e) => tracing::warn!(?e, "oracle relayer exited with error"),
        }
    });
    info!(feeds = feeds.len(), "oracle relayer spawned (Pyth Hermes)");
}

/// Convert a Decimal price (e.g. 100123.45) into the canonical 1e18-scaled
/// integer string the rest of the edge uses on the wire. Truncates rather
/// than rounds — matches existing `scale_x18` semantics in state.rs.
fn scale_decimal_to_x18(d: Decimal) -> String {
    let scale = Decimal::from_str_exact("1000000000000000000").expect("1e18 literal parses");
    (d * scale).trunc().normalize().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_decimal_to_x18_string() {
        // 100,123.45 → 100123.45 * 1e18 (truncated)
        let d = Decimal::from_str_exact("100123.45").unwrap();
        assert_eq!(scale_decimal_to_x18(d), "100123450000000000000000");
    }

    #[test]
    fn default_feeds_cover_v1_markets() {
        let f = default_feeds();
        let markets: Vec<&str> = f.iter().map(|b| b.market_id.as_str()).collect();
        assert!(markets.contains(&"btc-usd"));
        assert!(markets.contains(&"eth-usd"));
        assert!(markets.contains(&"sol-usd"));
    }
}
