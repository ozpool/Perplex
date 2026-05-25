//! `perplex-cli` operator binary. The first subcommand is `quote`, which spins up the
//! synthetic-counterparty maker. Configuration is via CLI flags + env so the same binary
//! works under systemd / docker without a separate config file.

use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use perplex_cli::metrics as cp_metrics;
use perplex_cli::{
    run_quote_agent, EdgeMarketsOracle, EdgeRiskSource, HttpEdgeClient, QuoteAgentConfig,
    StrategyParams,
};
use perplex_funding::RedisBackend;

#[derive(Parser)]
#[command(name = "perplex-cli", about = "Perplex operator tooling")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the synthetic-counterparty quote agent.
    Quote(QuoteArgs),
}

#[derive(clap::Args)]
struct QuoteArgs {
    /// Comma-separated markets to quote, e.g. `btc-usd,eth-usd,sol-usd`.
    #[arg(long, env = "PERPLEX_MARKETS", value_delimiter = ',')]
    markets: Vec<String>,
    /// HTTP base URL for perplex-edge.
    #[arg(
        long,
        env = "PERPLEX_EDGE_URL",
        default_value = "http://localhost:8080"
    )]
    edge_url: String,
    /// Redis URL used for the per-market single-writer lease.
    #[arg(
        long,
        env = "PERPLEX_REDIS_URL",
        default_value = "redis://localhost:6379"
    )]
    redis_url: String,
    /// Address the agent acts as. Must match the bearer token's `sub` claim.
    #[arg(long, env = "PERPLEX_AGENT_ACCOUNT")]
    account: String,
    /// Bearer JWT for the edge. Mint via `/__dev/token/<addr>` on devnet or your SIWE flow.
    #[arg(long, env = "PERPLEX_AGENT_BEARER")]
    bearer: String,

    // -- strategy --------------------------------------------------------------
    /// Base spread in bps (applied symmetrically around skewed mid).
    #[arg(long, env = "PERPLEX_BASE_SPREAD_BPS", default_value_t = 10)]
    base_spread_bps: u32,
    /// Inventory penalty (bps) added at `|inventory| == inventory_max`.
    #[arg(long, env = "PERPLEX_INV_PENALTY_BPS", default_value_t = 20)]
    inv_penalty_bps: u32,
    /// Inventory magnitude (base-asset units) at which the inventory penalty saturates.
    #[arg(long, env = "PERPLEX_INV_MAX", default_value_t = 100.0)]
    inv_max: f64,
    /// Inventory mid skew (bps) at `|inventory| == inventory_max`.
    #[arg(long, env = "PERPLEX_INV_SKEW_BPS", default_value_t = 5)]
    inv_skew_bps: u32,
    /// Multiplier (bps per unit of realised log-return stdev) on the vol-penalty term.
    #[arg(long, env = "PERPLEX_VOL_MULT_BPS", default_value_t = 1000)]
    vol_mult_bps: u32,
    /// Realised-vol window in seconds. PRD calls for 15 min (900s); short devnet runs can
    /// use 60 to converge inside a smoke-test budget.
    #[arg(long, env = "PERPLEX_VOL_WINDOW_SECS", default_value_t = 900)]
    vol_window_secs: u64,
    /// Kill threshold in USDC (positive). The agent stops quoting a market when its
    /// realised PnL drops below `-kill_threshold_usdc`.
    #[arg(long, env = "PERPLEX_KILL_THRESHOLD_USDC", default_value_t = 500.0)]
    kill_threshold_usdc: f64,

    // -- loop ------------------------------------------------------------------
    /// Quote size in base-asset units.
    #[arg(long, env = "PERPLEX_QUOTE_SIZE", default_value = "0.05")]
    quote_size: String,
    /// Oracle / reprice poll interval in milliseconds.
    #[arg(long, env = "PERPLEX_POLL_INTERVAL_MS", default_value_t = 500)]
    poll_interval_ms: u64,
    /// Lease TTL in seconds; should be ≥ 2x poll interval.
    #[arg(long, env = "PERPLEX_LEASE_TTL_SECS", default_value_t = 5)]
    lease_ttl_secs: u64,
    /// Skip cancel/replace when the mid moves by less than this many bps.
    #[arg(long, env = "PERPLEX_REPRICE_THRESHOLD_BPS", default_value_t = 1)]
    reprice_threshold_bps: u32,
    /// Dev signature padding accepted by the edge. Replaced by EIP-712 signing in prod.
    #[arg(long, env = "PERPLEX_ORDER_SIGNATURE", default_value = "0x00")]
    order_signature: String,
    /// Prometheus exporter bind address (host:port). Empty to disable.
    #[arg(long, env = "PERPLEX_METRICS_BIND", default_value = "0.0.0.0:9100")]
    metrics_bind: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,perplex_cli=debug")),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Quote(args) => run_quote(args).await,
    }
}

async fn run_quote(args: QuoteArgs) -> Result<()> {
    if args.markets.is_empty() {
        return Err(anyhow!("--markets must list at least one market"));
    }

    if !args.metrics_bind.is_empty() {
        let bind: SocketAddr = args
            .metrics_bind
            .parse()
            .with_context(|| format!("parse --metrics-bind {}", args.metrics_bind))?;
        cp_metrics::install_exporter(bind)?;
        tracing::info!(%bind, "prometheus exporter listening");
    }

    let signature = expand_signature(&args.order_signature);

    let config = QuoteAgentConfig {
        markets: args.markets,
        account: args.account.clone(),
        strategy: StrategyParams {
            base_spread_bps: args.base_spread_bps,
            inv_penalty_bps_at_max: args.inv_penalty_bps,
            inv_max: args.inv_max,
            vol_mult_bps: args.vol_mult_bps,
            inv_skew_bps_at_max: args.inv_skew_bps,
        },
        vol_window: Duration::from_secs(args.vol_window_secs),
        kill_threshold_usdc: args.kill_threshold_usdc,
        quote_size: args.quote_size,
        poll_interval: Duration::from_millis(args.poll_interval_ms),
        lease_ttl: Duration::from_secs(args.lease_ttl_secs),
        reprice_threshold_bps: args.reprice_threshold_bps,
        order_signature: signature,
    };

    let edge = HttpEdgeClient::new(&args.edge_url, &args.bearer);
    let oracle = EdgeMarketsOracle::new(&args.edge_url);
    let risk = EdgeRiskSource::new(&args.edge_url, &args.bearer);
    let lease = RedisBackend::new(&args.redis_url)
        .with_context(|| format!("init redis at {}", args.redis_url))?;

    run_quote_agent(config, lease, edge, oracle, risk).await
}

/// Pad the signature flag out to the 132-character minimum the edge enforces (66 bytes hex
/// + `0x`). The `--order-signature 0x00` shorthand is convenient when the dev edge accepts
///   any length-valid hex string.
fn expand_signature(input: &str) -> String {
    let body = input.strip_prefix("0x").unwrap_or(input);
    if body.len() >= 130 {
        return format!("0x{body}");
    }
    let padding = "0".repeat(130 - body.len());
    format!("0x{body}{padding}")
}
