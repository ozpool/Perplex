//! Prometheus metrics surface for the synthetic counterparty agent. Naming convention
//! matches `infra/grafana/counterparty.json` — change one, change the other.
//!
//! All series carry a `market` label. Gauges represent the most recent observation;
//! counters increment monotonically and are rate()'d in the dashboard.
//!
//! ```text
//! counterparty_realised_pnl_usdc{market}        gauge    latest realised PnL in USDC
//! counterparty_inventory{market}                gauge    signed base-asset position
//! counterparty_realised_vol{market}             gauge    rolling stdev of log-returns
//! counterparty_spread_bps{market}               gauge    last-computed spread in bps
//! counterparty_skew_bps{market}                 gauge    last-computed mid skew in bps
//! counterparty_quote_places_total{market,side}  counter  cumulative place_order calls
//! counterparty_quote_cancels_total{market,side} counter  cumulative cancel_order calls
//! counterparty_fills_total{market}              counter  inferred fills (inventory delta)
//! counterparty_kill_trips_total{market}         counter  kill-switch trip events
//! ```

use std::net::SocketAddr;

use anyhow::{Context, Result};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

pub const REALISED_PNL: &str = "counterparty_realised_pnl_usdc";
pub const INVENTORY: &str = "counterparty_inventory";
pub const REALISED_VOL: &str = "counterparty_realised_vol";
pub const SPREAD_BPS: &str = "counterparty_spread_bps";
pub const SKEW_BPS: &str = "counterparty_skew_bps";
pub const QUOTE_PLACES_TOTAL: &str = "counterparty_quote_places_total";
pub const QUOTE_CANCELS_TOTAL: &str = "counterparty_quote_cancels_total";
pub const FILLS_TOTAL: &str = "counterparty_fills_total";
pub const KILL_TRIPS_TOTAL: &str = "counterparty_kill_trips_total";

/// All metric names emitted by the agent, exposed so the smoke test can assert the
/// dashboard's `expr` strings reference real series.
pub const ALL_METRIC_NAMES: &[&str] = &[
    REALISED_PNL,
    INVENTORY,
    REALISED_VOL,
    SPREAD_BPS,
    SKEW_BPS,
    QUOTE_PLACES_TOTAL,
    QUOTE_CANCELS_TOTAL,
    FILLS_TOTAL,
    KILL_TRIPS_TOTAL,
];

/// Install the Prometheus HTTP listener. Returns the handle so tests can render the
/// snapshot directly without going over HTTP.
pub fn install_exporter(bind: SocketAddr) -> Result<PrometheusHandle> {
    let builder = PrometheusBuilder::new().with_http_listener(bind);
    let handle = builder
        .install_recorder()
        .with_context(|| format!("install prometheus recorder on {bind}"))?;
    describe();
    Ok(handle)
}

/// Install the recorder only (no HTTP listener) — used by tests to render snapshots
/// from a thread-local recorder.
pub fn install_recorder_only() -> Result<PrometheusHandle> {
    let handle = PrometheusBuilder::new()
        .install_recorder()
        .context("install prometheus recorder")?;
    describe();
    Ok(handle)
}

fn describe() {
    metrics::describe_gauge!(REALISED_PNL, "Latest realised PnL in USDC per market");
    metrics::describe_gauge!(INVENTORY, "Signed base-asset inventory per market");
    metrics::describe_gauge!(REALISED_VOL, "Rolling stdev of log-returns per market");
    metrics::describe_gauge!(SPREAD_BPS, "Last-computed spread in bps per market");
    metrics::describe_gauge!(SKEW_BPS, "Last-computed mid skew in bps per market");
    metrics::describe_counter!(
        QUOTE_PLACES_TOTAL,
        "Cumulative place_order calls per market+side"
    );
    metrics::describe_counter!(
        QUOTE_CANCELS_TOTAL,
        "Cumulative cancel_order calls per market+side"
    );
    metrics::describe_counter!(
        FILLS_TOTAL,
        "Inferred fills per market (inventory delta between ticks)"
    );
    metrics::describe_counter!(KILL_TRIPS_TOTAL, "Kill-switch trip events per market");
}

/// Helper for recording a quote-place. Keeps label keys consistent at all call sites.
pub fn record_place(market: &str, side: &str) {
    metrics::counter!(
        QUOTE_PLACES_TOTAL,
        "market" => market.to_string(),
        "side" => side.to_string(),
    )
    .increment(1);
}

pub fn record_cancel(market: &str, side: &str) {
    metrics::counter!(
        QUOTE_CANCELS_TOTAL,
        "market" => market.to_string(),
        "side" => side.to_string(),
    )
    .increment(1);
}

pub fn record_fill(market: &str, count: u64) {
    if count == 0 {
        return;
    }
    metrics::counter!(FILLS_TOTAL, "market" => market.to_string()).increment(count);
}

pub fn record_kill_trip(market: &str) {
    metrics::counter!(KILL_TRIPS_TOTAL, "market" => market.to_string()).increment(1);
}

pub fn set_realised_pnl(market: &str, value: f64) {
    metrics::gauge!(REALISED_PNL, "market" => market.to_string()).set(value);
}

pub fn set_inventory(market: &str, value: f64) {
    metrics::gauge!(INVENTORY, "market" => market.to_string()).set(value);
}

pub fn set_realised_vol(market: &str, value: f64) {
    metrics::gauge!(REALISED_VOL, "market" => market.to_string()).set(value);
}

pub fn set_spread_bps(market: &str, value: f64) {
    metrics::gauge!(SPREAD_BPS, "market" => market.to_string()).set(value);
}

pub fn set_skew_bps(market: &str, value: f64) {
    metrics::gauge!(SKEW_BPS, "market" => market.to_string()).set(value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use metrics::with_local_recorder;
    use metrics_exporter_prometheus::PrometheusBuilder;

    /// Render the in-memory exporter snapshot after recording one sample for each
    /// metric the agent emits. Used to prove the names + label keys land in the
    /// Prometheus text format exactly as the dashboard expects.
    #[test]
    fn every_metric_renders_with_market_label() {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        with_local_recorder(&recorder, || {
            describe();
            set_realised_pnl("btc-usd", 12.5);
            set_inventory("btc-usd", -0.5);
            set_realised_vol("btc-usd", 0.002);
            set_spread_bps("btc-usd", 10.0);
            set_skew_bps("btc-usd", -2.5);
            record_place("btc-usd", "buy");
            record_cancel("btc-usd", "sell");
            record_fill("btc-usd", 3);
            record_kill_trip("btc-usd");
        });

        let body = handle.render();
        for name in ALL_METRIC_NAMES {
            assert!(
                body.contains(name),
                "metric '{name}' missing from /metrics output:\n{body}"
            );
            assert!(
                body.contains(&format!("{name}{{")),
                "metric '{name}' rendered without labels in /metrics output"
            );
        }
        // Sanity: market label must be the exact key the dashboard filters on.
        assert!(body.contains("market=\"btc-usd\""), "market label missing");
    }
}
