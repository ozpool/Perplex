//! Periodic market-stats broadcaster.
//!
//! Recomputes the live funding rate + next-settlement timestamp for every
//! market on a fixed tick and fans the result out over the `funding.{marketId}`
//! WS channel. The same numbers are also available on `/v1/markets` (computed
//! at read time inside `state::decorate_market`), but pushing them gives the
//! FE a no-poll path so the funding pill in the header updates immediately
//! when the oracle drifts the orderbook off mid.
//!
//! Volume and open interest are pure reads of in-memory state — there's no
//! ticker for them; clients pick them up on the next `/v1/markets` refetch.

use std::time::Duration;

use serde_json::json;
use tokio::time::interval;
use tracing::info;

use crate::state::{now_ns, AppState};
use crate::ws::{Hub, Message, Topic};

/// Spawn the stats ticker on the current Tokio runtime. The task runs until
/// the runtime shuts down. One frame per market per `period` is cheap —
/// it's just a Decimal divide plus a serde_json::json! macro.
pub fn spawn_market_stats_ticker(state: AppState, hub: Hub, period: Duration) {
    tokio::spawn(async move {
        let mut tick = interval(period);
        info!(
            period_ms = period.as_millis() as u64,
            "market-stats ticker started"
        );
        loop {
            tick.tick().await;
            let markets = state.list_markets();
            for m in markets {
                let payload = json!({
                    "type": "funding",
                    "channel": format!("funding.{}", m.id),
                    "currentRateBps": m.funding_rate_bps,
                    "nextSettlementTsNs": m.next_funding_ts_ns,
                    "tsNs": now_ns().to_string(),
                });
                hub.publish(Message {
                    topic: Topic::Funding(m.id.clone()),
                    payload,
                });
            }
        }
    });
}
