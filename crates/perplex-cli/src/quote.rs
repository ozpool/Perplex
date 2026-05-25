//! Quote agent loop. One task per market, each holding a per-market Redis lease so only
//! one agent instance is quoting at a time. Strategy lives in `crate::strategy`; this
//! module owns the orchestration: oracle polling, vol-window sampling, risk fetching,
//! kill-switch evaluation, and cancel/replace bookkeeping.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use perplex_funding::LeaseBackend;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::edge::{EdgeClient, PlaceOrderRequest};
use crate::kill::KillSwitch;
use crate::metrics;
use crate::oracle::OracleSource;
use crate::risk::RiskSource;
use crate::strategy::{Quotes, StrategyParams};
use crate::vol::VolWindow;

#[derive(Debug, Clone)]
pub struct QuoteAgentConfig {
    /// Markets the agent should quote, e.g. `["btc-usd", "eth-usd"]`.
    pub markets: Vec<String>,
    /// Address the agent signs as. Used for `clientOrderId` namespacing and structured logs.
    pub account: String,
    /// Pricing strategy params (base spread, inventory penalty, vol multiplier, skew).
    pub strategy: StrategyParams,
    /// Realised-vol window length. The PRD calls for 15 min but devnet runs can use a
    /// shorter window to react inside the smoke-test budget.
    pub vol_window: Duration,
    /// Per-market kill threshold (positive USDC); the switch trips when the latest
    /// realised PnL drops below `-kill_threshold_usdc`.
    pub kill_threshold_usdc: f64,
    /// Quote size in base-asset units, decimal-string ready (eg. "0.05").
    pub quote_size: String,
    /// Interval between oracle polls. Each tick: renew lease, sample mid, reprice if
    /// needed, sleep.
    pub poll_interval: Duration,
    /// Lease TTL. Should be at least 2-3x poll_interval to survive transient stalls.
    pub lease_ttl: Duration,
    /// Reprice threshold in bps. If the mid moves by less than this since the last quote,
    /// we skip the cancel/replace cycle to avoid order-id churn under noise.
    pub reprice_threshold_bps: u32,
    /// Static order signature accepted by edge in dev mode (must satisfy the basic length
    /// check). Real-prod hardening replaces this with per-order EIP-712 signing.
    pub order_signature: String,
}

impl Default for QuoteAgentConfig {
    fn default() -> Self {
        Self {
            markets: vec!["btc-usd".into(), "eth-usd".into(), "sol-usd".into()],
            account: "0x0000000000000000000000000000000000000000".into(),
            strategy: StrategyParams::default(),
            vol_window: Duration::from_secs(15 * 60),
            kill_threshold_usdc: 500.0,
            quote_size: "0.05".into(),
            poll_interval: Duration::from_millis(500),
            lease_ttl: Duration::from_secs(5),
            reprice_threshold_bps: 1,
            order_signature: format!("0x{}", "00".repeat(65)),
        }
    }
}

/// Per-market mutable state. Kept behind a single Mutex so the iteration is atomic from
/// the agent's perspective — cancel and replace can't interleave with a concurrent tick.
#[derive(Debug)]
pub(crate) struct MarketState {
    pub bid_order_id: Option<String>,
    pub ask_order_id: Option<String>,
    pub last_mid: Option<f64>,
    pub last_inventory: Option<f64>,
    pub vol: VolWindow,
}

impl MarketState {
    fn new(vol_window: Duration) -> Self {
        Self {
            bid_order_id: None,
            ask_order_id: None,
            last_mid: None,
            last_inventory: None,
            vol: VolWindow::new(vol_window),
        }
    }
}

/// Single iteration of the quote loop. Module-private — tests in the same module drive
/// it directly to avoid spinning up the full lease / sleep cycle.
pub(crate) async fn run_quote_iteration<E, O, R>(
    market_id: &str,
    config: &QuoteAgentConfig,
    edge: &E,
    oracle: &O,
    risk: &R,
    kill: &KillSwitch,
    state: &Arc<Mutex<MarketState>>,
) -> Result<()>
where
    E: EdgeClient + ?Sized,
    O: OracleSource + ?Sized,
    R: RiskSource + ?Sized,
{
    let mid = oracle
        .mid_price(market_id)
        .await
        .with_context(|| format!("oracle mid for {market_id}"))?;
    let market_risk = risk
        .fetch(market_id)
        .await
        .with_context(|| format!("risk fetch for {market_id}"))?;

    let mut guard = state.lock().await;
    guard.vol.record(Instant::now(), mid);

    metrics::set_realised_pnl(market_id, market_risk.realised_pnl_usdc);
    metrics::set_inventory(market_id, market_risk.inventory);

    let quote_size = config.quote_size.parse::<f64>().unwrap_or(0.0);
    if let Some(prev) = guard.last_inventory {
        let delta = (market_risk.inventory - prev).abs();
        if delta > 1e-12 {
            let fills = if quote_size > 0.0 {
                (delta / quote_size).round().max(1.0) as u64
            } else {
                1
            };
            metrics::record_fill(market_id, fills);
        }
    }
    guard.last_inventory = Some(market_risk.inventory);

    let kill_was_tripped = kill.is_tripped();
    if kill.observe(market_risk.realised_pnl_usdc) {
        if !kill_was_tripped {
            metrics::record_kill_trip(market_id);
        }
        // Kill switch tripped. Cancel any live quotes (idempotent) and refuse to place
        // new ones until the operator resets the switch out-of-band.
        let bid = guard.bid_order_id.take();
        let ask = guard.ask_order_id.take();
        drop(guard);
        if let Some(id) = bid {
            let _ = edge.cancel_order(&id).await;
            metrics::record_cancel(market_id, "buy");
        }
        if let Some(id) = ask {
            let _ = edge.cancel_order(&id).await;
            metrics::record_cancel(market_id, "sell");
        }
        warn!(
            market_id,
            pnl = market_risk.realised_pnl_usdc,
            threshold = kill.threshold_usdc(),
            "kill switch tripped; quotes pulled"
        );
        return Ok(());
    }

    let realised_vol = guard.vol.realised_vol();
    let quotes: Quotes = config
        .strategy
        .quotes(mid, market_risk.inventory, realised_vol);
    metrics::set_realised_vol(market_id, realised_vol);
    metrics::set_spread_bps(market_id, quotes.spread_bps);
    metrics::set_skew_bps(market_id, quotes.skew_bps);
    debug!(
        market_id,
        mid,
        inv = market_risk.inventory,
        vol = realised_vol,
        bid = quotes.bid,
        ask = quotes.ask,
        spread_bps = quotes.spread_bps,
        skew_bps = quotes.skew_bps,
        "computed quotes"
    );

    if let Some(last) = guard.last_mid {
        let move_bps = ((mid - last).abs() / last) * 10_000.0;
        if move_bps < config.reprice_threshold_bps as f64
            && guard.bid_order_id.is_some()
            && guard.ask_order_id.is_some()
        {
            return Ok(());
        }
    }

    if let Some(bid_id) = guard.bid_order_id.take() {
        if let Err(err) = edge.cancel_order(&bid_id).await {
            warn!(market_id, %err, "cancel bid failed, will resubmit anyway");
        }
        metrics::record_cancel(market_id, "buy");
    }
    if let Some(ask_id) = guard.ask_order_id.take() {
        if let Err(err) = edge.cancel_order(&ask_id).await {
            warn!(market_id, %err, "cancel ask failed, will resubmit anyway");
        }
        metrics::record_cancel(market_id, "sell");
    }

    let bid_req = build_order(market_id, config, "buy", quotes.bid);
    let ask_req = build_order(market_id, config, "sell", quotes.ask);
    let bid_id = edge.place_order(&bid_req).await.context("place bid")?;
    metrics::record_place(market_id, "buy");
    let ask_id = edge.place_order(&ask_req).await.context("place ask")?;
    metrics::record_place(market_id, "sell");
    guard.bid_order_id = Some(bid_id);
    guard.ask_order_id = Some(ask_id);
    guard.last_mid = Some(mid);
    let _ = market_risk;
    Ok(())
}

fn build_order(
    market_id: &str,
    config: &QuoteAgentConfig,
    side: &str,
    price: f64,
) -> PlaceOrderRequest {
    let coid = format!("cli-{}-{}-{}", config.account, market_id, side);
    PlaceOrderRequest {
        market_id: market_id.to_string(),
        side: side.into(),
        order_type: "limit".into(),
        price: Some(format!("{price:.8}")),
        qty: config.quote_size.clone(),
        time_in_force: "gtc".into(),
        reduce_only: false,
        post_only: true,
        client_order_id: Some(coid),
        nonce: format!("{}", chrono_nonce()),
        signature: config.order_signature.clone(),
    }
}

fn chrono_nonce() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Per-market lease key. Two agents pointed at the same Redis cluster MUST agree on this
/// namespace or single-writer is violated. Don't change without a config migration plan.
fn lease_key(market_id: &str) -> String {
    format!("perplex:quote-agent:lease:{market_id}")
}

pub async fn acquire_market_lease<B: LeaseBackend>(
    backend: &B,
    market_id: &str,
    ttl: Duration,
) -> Result<String> {
    let token = uuid::Uuid::new_v4().to_string();
    let acquired = backend
        .try_acquire(&lease_key(market_id), &token, ttl)
        .await
        .map_err(|e| anyhow!("redis: {e}"))?;
    if !acquired {
        return Err(anyhow!(
            "lease for {market_id} already held by another quote-agent instance"
        ));
    }
    Ok(token)
}

pub async fn run_quote_agent<B, E, O, R>(
    config: QuoteAgentConfig,
    lease: B,
    edge: E,
    oracle: O,
    risk: R,
) -> Result<()>
where
    B: LeaseBackend + 'static,
    E: EdgeClient + 'static,
    O: OracleSource + 'static,
    R: RiskSource + 'static,
{
    let edge = Arc::new(edge);
    let oracle = Arc::new(oracle);
    let lease = Arc::new(lease);
    let risk = Arc::new(risk);
    let config = Arc::new(config);

    let mut handles = Vec::new();
    for market_id in config.markets.clone() {
        let token = acquire_market_lease(&*lease, &market_id, config.lease_ttl).await?;
        info!(market = %market_id, "lease acquired");
        let handle = tokio::spawn(market_loop(
            market_id.clone(),
            token,
            Arc::clone(&config),
            Arc::clone(&lease),
            Arc::clone(&edge),
            Arc::clone(&oracle),
            Arc::clone(&risk),
        ));
        handles.push(handle);
    }
    for h in handles {
        if let Err(e) = h.await? {
            warn!("market loop ended with error: {e}");
        }
    }
    Ok(())
}

async fn market_loop<B, E, O, R>(
    market_id: String,
    token: String,
    config: Arc<QuoteAgentConfig>,
    lease: Arc<B>,
    edge: Arc<E>,
    oracle: Arc<O>,
    risk: Arc<R>,
) -> Result<()>
where
    B: LeaseBackend,
    E: EdgeClient,
    O: OracleSource,
    R: RiskSource,
{
    let state = Arc::new(Mutex::new(MarketState::new(config.vol_window)));
    let kill = KillSwitch::new(config.kill_threshold_usdc);
    loop {
        let renewed = lease
            .renew(&lease_key(&market_id), &token, config.lease_ttl)
            .await
            .map_err(|e| anyhow!("renew lease: {e}"))?;
        if !renewed {
            return Err(anyhow!(
                "lost lease for {market_id}; another instance has taken over"
            ));
        }
        if let Err(err) =
            run_quote_iteration(&market_id, &config, &*edge, &*oracle, &*risk, &kill, &state).await
        {
            warn!(market = %market_id, %err, "quote iteration failed; will retry next tick");
        }
        tokio::time::sleep(config.poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::risk::test_support::MockRiskSource;
    use crate::risk::MarketRisk;
    use async_trait::async_trait;
    use perplex_funding::MockBackend;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    #[derive(Default, Clone)]
    struct MockEdge {
        events: Arc<StdMutex<Vec<String>>>,
        next_id: Arc<StdMutex<u64>>,
    }

    impl MockEdge {
        fn events(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl EdgeClient for MockEdge {
        async fn place_order(
            &self,
            req: &PlaceOrderRequest,
        ) -> Result<String, crate::edge::EdgeError> {
            let mut n = self.next_id.lock().unwrap();
            *n += 1;
            let id = format!("ord_{}", *n);
            self.events.lock().unwrap().push(format!(
                "place {} {} @ {}",
                req.side,
                req.market_id,
                req.price.clone().unwrap_or_default()
            ));
            Ok(id)
        }

        async fn cancel_order(&self, order_id: &str) -> Result<(), crate::edge::EdgeError> {
            self.events
                .lock()
                .unwrap()
                .push(format!("cancel {order_id}"));
            Ok(())
        }
    }

    #[derive(Clone)]
    struct StaticOracle {
        prices: Arc<StdMutex<HashMap<String, f64>>>,
    }

    impl StaticOracle {
        fn new(seed: &[(&str, f64)]) -> Self {
            let map: HashMap<String, f64> =
                seed.iter().map(|(k, v)| ((*k).to_string(), *v)).collect();
            Self {
                prices: Arc::new(StdMutex::new(map)),
            }
        }

        fn set(&self, market: &str, price: f64) {
            self.prices
                .lock()
                .unwrap()
                .insert(market.to_string(), price);
        }
    }

    #[async_trait]
    impl OracleSource for StaticOracle {
        async fn mid_price(&self, market_id: &str) -> Result<f64, crate::oracle::OracleError> {
            self.prices
                .lock()
                .unwrap()
                .get(market_id)
                .copied()
                .ok_or_else(|| crate::oracle::OracleError::NotFound(market_id.into()))
        }
    }

    fn flat_cfg() -> QuoteAgentConfig {
        QuoteAgentConfig {
            markets: vec!["btc-usd".into()],
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn first_iteration_places_bid_and_ask() {
        let cfg = flat_cfg();
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let risk = MockRiskSource::new(&[]);
        let kill = KillSwitch::new(cfg.kill_threshold_usdc);
        let state = Arc::new(Mutex::new(MarketState::new(cfg.vol_window)));

        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();

        let events = edge.events();
        assert_eq!(events.len(), 2, "exactly bid + ask: {events:?}");
        assert!(events[0].starts_with("place buy"));
        assert!(events[1].starts_with("place sell"));
    }

    #[tokio::test]
    async fn second_iteration_cancels_when_price_moves() {
        let cfg = QuoteAgentConfig {
            reprice_threshold_bps: 1,
            ..flat_cfg()
        };
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let risk = MockRiskSource::new(&[]);
        let kill = KillSwitch::new(cfg.kill_threshold_usdc);
        let state = Arc::new(Mutex::new(MarketState::new(cfg.vol_window)));

        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        oracle.set("btc-usd", 101_000.0);
        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();

        let events = edge.events();
        assert_eq!(events.len(), 6, "{events:?}");
        assert!(events.iter().any(|e| e.starts_with("cancel ord_1")));
        assert!(events.iter().any(|e| e.starts_with("cancel ord_2")));
    }

    #[tokio::test]
    async fn second_iteration_skips_when_movement_below_threshold() {
        let cfg = QuoteAgentConfig {
            reprice_threshold_bps: 50,
            ..flat_cfg()
        };
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let risk = MockRiskSource::new(&[]);
        let kill = KillSwitch::new(cfg.kill_threshold_usdc);
        let state = Arc::new(Mutex::new(MarketState::new(cfg.vol_window)));

        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        oracle.set("btc-usd", 100_100.0);
        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();

        assert_eq!(edge.events().len(), 2, "second tick is a no-op");
    }

    #[tokio::test]
    async fn kill_switch_trips_and_pulls_quotes() {
        let cfg = QuoteAgentConfig {
            kill_threshold_usdc: 100.0,
            reprice_threshold_bps: 1,
            ..flat_cfg()
        };
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let risk = MockRiskSource::new(&[(
            "btc-usd",
            MarketRisk {
                inventory: 0.0,
                realised_pnl_usdc: 0.0,
            },
        )]);
        let kill = KillSwitch::new(cfg.kill_threshold_usdc);
        let state = Arc::new(Mutex::new(MarketState::new(cfg.vol_window)));

        // Round 1: healthy, quotes get placed.
        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        assert_eq!(edge.events().len(), 2);

        // Round 2: blow past the threshold → kill trips → cancels and skips placing.
        risk.set(
            "btc-usd",
            MarketRisk {
                inventory: 0.0,
                realised_pnl_usdc: -250.0,
            },
        );
        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        let events = edge.events();
        assert!(kill.is_tripped());
        assert!(events.iter().filter(|e| e.starts_with("cancel ")).count() >= 2);
        assert_eq!(
            events.iter().filter(|e| e.starts_with("place ")).count(),
            2,
            "no new places after kill"
        );

        // Round 3: even if PnL recovers, the switch stays tripped — no new orders.
        risk.set(
            "btc-usd",
            MarketRisk {
                inventory: 0.0,
                realised_pnl_usdc: 1_000.0,
            },
        );
        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        assert_eq!(
            edge.events()
                .iter()
                .filter(|e| e.starts_with("place "))
                .count(),
            2,
            "kill is sticky"
        );
    }

    #[tokio::test]
    async fn long_inventory_skews_quotes_down() {
        let cfg = QuoteAgentConfig {
            strategy: StrategyParams {
                base_spread_bps: 10,
                inv_penalty_bps_at_max: 0,
                inv_max: 100.0,
                vol_mult_bps: 0,
                inv_skew_bps_at_max: 20,
            },
            ..flat_cfg()
        };
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let risk = MockRiskSource::new(&[(
            "btc-usd",
            MarketRisk {
                inventory: 100.0, // at cap → full negative skew
                realised_pnl_usdc: 0.0,
            },
        )]);
        let kill = KillSwitch::new(cfg.kill_threshold_usdc);
        let state = Arc::new(Mutex::new(MarketState::new(cfg.vol_window)));

        run_quote_iteration("btc-usd", &cfg, &edge, &oracle, &risk, &kill, &state)
            .await
            .unwrap();
        let events = edge.events();
        // skew_bps = -20, half spread = 5 bps → mid_skewed = 99_800
        //   bid = 99_800 * (1 - 0.0005) = 99_750.1
        //   ask = 99_800 * (1 + 0.0005) = 99_849.9
        // Both must sit below the un-skewed mid of 100_000.
        let buy_price: f64 = events[0]
            .split_whitespace()
            .last()
            .unwrap()
            .parse()
            .unwrap();
        let sell_price: f64 = events[1]
            .split_whitespace()
            .last()
            .unwrap()
            .parse()
            .unwrap();
        assert!(buy_price < 100_000.0);
        assert!(sell_price < 100_000.0);
    }

    #[tokio::test]
    async fn lease_is_exclusive_per_market() {
        let backend = MockBackend::new();
        let first = acquire_market_lease(&backend, "btc-usd", Duration::from_secs(5))
            .await
            .unwrap();
        let second = acquire_market_lease(&backend, "btc-usd", Duration::from_secs(5)).await;
        assert!(second.is_err(), "second acquisition must fail");
        acquire_market_lease(&backend, "eth-usd", Duration::from_secs(5))
            .await
            .unwrap();
        assert!(!first.is_empty());
    }
}
