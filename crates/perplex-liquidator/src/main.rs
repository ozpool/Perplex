//! Off-chain liquidation keeper.
//!
//! Polls the edge for positions whose health factor has dropped below 1.0 and
//! force-closes each one through the edge's admin liquidation endpoint. This is
//! the automatic trigger the perp DEX needs: without it, a losing trader's
//! position sits underwater and the protocol eats the bad debt.
//!
//! It talks to the same off-chain edge that owns position state today. When the
//! trade flow moves on-chain, this keeper swaps its two HTTP calls for a read of
//! the on-chain PositionRegistry + a call to LiquidationEngine.liquidate(); the
//! health math (perplex-core::margin) is already shared between both sides.
//!
//! Auth: every request carries `x-admin-secret`, matched against the edge's
//! `PERPLEX_ADMIN_SECRET`. The same secret must be set here.

use std::time::Duration;

use clap::Parser;
use serde::Deserialize;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "perplex-liquidator",
    about = "Off-chain liquidation keeper for Perplex"
)]
struct Args {
    /// Base URL of the edge REST API.
    #[arg(
        long,
        env = "PERPLEX_EDGE_URL",
        default_value = "http://127.0.0.1:8080"
    )]
    edge_url: String,

    /// Shared admin secret; must equal the edge's PERPLEX_ADMIN_SECRET.
    #[arg(long, env = "PERPLEX_ADMIN_SECRET")]
    admin_secret: String,

    /// How often to scan for underwater positions, in milliseconds.
    #[arg(long, env = "PERPLEX_LIQUIDATOR_INTERVAL_MS", default_value_t = 2000)]
    interval_ms: u64,
}

/// One entry from `GET /v1/admin/liquidatable`.
#[derive(Debug, Deserialize)]
struct Liquidatable {
    address: String,
    #[serde(rename = "marketId")]
    market_id: String,
    #[serde(rename = "healthFactor")]
    health_factor: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,perplex_liquidator=info")),
        )
        .json()
        .init();

    let args = Args::parse();
    if args.admin_secret.is_empty() {
        anyhow::bail!("PERPLEX_ADMIN_SECRET (or --admin-secret) is required");
    }

    let client = reqwest::Client::new();
    let base = args.edge_url.trim_end_matches('/');
    let scan_url = format!("{base}/v1/admin/liquidatable");
    let liquidate_url = format!("{base}/v1/admin/liquidate");

    tracing::info!(
        edge = %args.edge_url,
        interval_ms = args.interval_ms,
        "liquidation keeper started"
    );

    let mut tick = tokio::time::interval(Duration::from_millis(args.interval_ms));
    loop {
        tick.tick().await;

        let targets: Vec<Liquidatable> = match client
            .get(&scan_url)
            .header("x-admin-secret", &args.admin_secret)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => resp.json().await.unwrap_or_default(),
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), "scan rejected by edge");
                continue;
            }
            Err(e) => {
                tracing::warn!(error = %e, "scan request failed");
                continue;
            }
        };

        if targets.is_empty() {
            continue;
        }
        tracing::info!(count = targets.len(), "underwater positions found");

        for t in targets {
            let body = serde_json::json!({ "address": t.address, "marketId": t.market_id });
            match client
                .post(&liquidate_url)
                .header("x-admin-secret", &args.admin_secret)
                .json(&body)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    let outcome: serde_json::Value = resp.json().await.unwrap_or_default();
                    tracing::info!(
                        address = %t.address,
                        market = %t.market_id,
                        health = %t.health_factor,
                        outcome = %outcome,
                        "position liquidated"
                    );
                }
                // A racing keeper (or a price tick back to health) makes the
                // position no longer liquidatable; the edge returns 400 and we
                // simply move on.
                Ok(resp) => tracing::warn!(
                    address = %t.address,
                    market = %t.market_id,
                    status = %resp.status(),
                    "liquidate rejected"
                ),
                Err(e) => tracing::warn!(error = %e, "liquidate request failed"),
            }
        }
    }
}
