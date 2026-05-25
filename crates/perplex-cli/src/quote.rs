//! Quote agent loop. One task per market, each holding a per-market Redis lease so only
//! one agent instance is quoting at a time. Strategy is a base-spread symmetric quoter;
//! Phase 7 follow-ups (#44) introduce the inventory / vol / kill-switch logic on top.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use perplex_funding::LeaseBackend;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::edge::{EdgeClient, PlaceOrderRequest};
use crate::oracle::OracleSource;

/// Configuration for a quote-agent instance. One config applies to all markets the binary
/// is told to quote; individual market state (last price, open orders, lease token) lives
/// in the per-market loop.
#[derive(Debug, Clone)]
pub struct QuoteAgentConfig {
    /// Markets the agent should quote, e.g. `["btc-usd", "eth-usd"]`.
    pub markets: Vec<String>,
    /// Address the agent signs as. Used for `clientOrderId` namespacing and structured logs.
    pub account: String,
    /// Half-spread (bps) added on each side of mid. A 10-bps base means a 20-bps total
    /// spread (5 bps below mid for the bid, 5 bps above for the ask).
    pub base_spread_bps: u32,
    /// Quote size in base-asset units, decimal-string ready (eg. "0.05").
    pub quote_size: String,
    /// Interval between oracle polls. Each tick: renew lease, reprice if mid moved, sleep.
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
            base_spread_bps: 10,
            quote_size: "0.05".into(),
            poll_interval: Duration::from_millis(500),
            lease_ttl: Duration::from_secs(5),
            reprice_threshold_bps: 1,
            order_signature: format!("0x{}", "00".repeat(65)),
        }
    }
}

/// Pure pricing strategy. Returned by the agent loop and isolated for unit testing —
/// follow-up issue #44 grows this with inventory + vol terms without touching the loop.
#[derive(Debug, Clone)]
pub struct QuoteStrategy {
    pub base_spread_bps: u32,
}

impl QuoteStrategy {
    pub fn new(base_spread_bps: u32) -> Self {
        Self { base_spread_bps }
    }

    /// Returns `(bid, ask)` for a given `mid`. Half-spread on each side; we never let the
    /// bid exceed mid or the ask drop below mid.
    pub fn quotes(&self, mid: f64) -> (f64, f64) {
        let half = self.base_spread_bps as f64 / 2.0 / 10_000.0;
        let bid = mid * (1.0 - half);
        let ask = mid * (1.0 + half);
        (bid, ask)
    }
}

/// Tracks the live quote pair for a single market across iterations of the loop. Held
/// behind a Mutex inside the per-market task so cancel-and-replace is atomic from the
/// agent's perspective even if a future strategy fans out further.
#[derive(Debug, Default)]
pub(crate) struct OpenQuotes {
    bid_order_id: Option<String>,
    ask_order_id: Option<String>,
    last_mid: Option<f64>,
}

/// Single iteration of the quote loop. Module-private — tests in the same module drive
/// it directly to avoid spinning up the full lease / sleep cycle.
pub(crate) async fn run_quote_iteration<E, O>(
    market_id: &str,
    config: &QuoteAgentConfig,
    strategy: &QuoteStrategy,
    edge: &E,
    oracle: &O,
    state: &Arc<Mutex<OpenQuotes>>,
) -> Result<()>
where
    E: EdgeClient + ?Sized,
    O: OracleSource + ?Sized,
{
    let mid = oracle
        .mid_price(market_id)
        .await
        .with_context(|| format!("oracle mid for {market_id}"))?;
    let (bid, ask) = strategy.quotes(mid);
    let mut guard = state.lock().await;

    if let Some(last) = guard.last_mid {
        let move_bps = ((mid - last).abs() / last) * 10_000.0;
        if move_bps < config.reprice_threshold_bps as f64
            && guard.bid_order_id.is_some()
            && guard.ask_order_id.is_some()
        {
            debug!(
                market_id,
                mid, last, "skip reprice; movement under threshold"
            );
            return Ok(());
        }
    }

    if let Some(bid_id) = guard.bid_order_id.take() {
        if let Err(err) = edge.cancel_order(&bid_id).await {
            warn!(market_id, %err, "cancel bid failed, will resubmit anyway");
        }
    }
    if let Some(ask_id) = guard.ask_order_id.take() {
        if let Err(err) = edge.cancel_order(&ask_id).await {
            warn!(market_id, %err, "cancel ask failed, will resubmit anyway");
        }
    }

    let bid_req = build_order(market_id, config, "buy", bid);
    let ask_req = build_order(market_id, config, "sell", ask);
    let bid_id = edge.place_order(&bid_req).await.context("place bid")?;
    let ask_id = edge.place_order(&ask_req).await.context("place ask")?;
    guard.bid_order_id = Some(bid_id);
    guard.ask_order_id = Some(ask_id);
    guard.last_mid = Some(mid);
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

/// Acquire the lease for a market. Returns `Ok(token)` on success or an error if another
/// instance holds the lease — surfaced verbatim to the operator so the CLI exits non-zero
/// instead of silently doing nothing.
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

/// Run the agent across all configured markets. Each market gets its own task so a slow
/// edge or oracle response on one market doesn't stall the others.
pub async fn run_quote_agent<B, E, O>(
    config: QuoteAgentConfig,
    lease: B,
    edge: E,
    oracle: O,
) -> Result<()>
where
    B: LeaseBackend + 'static,
    E: EdgeClient + 'static,
    O: OracleSource + 'static,
{
    let edge = Arc::new(edge);
    let oracle = Arc::new(oracle);
    let lease = Arc::new(lease);
    let strategy = QuoteStrategy::new(config.base_spread_bps);
    let config = Arc::new(config);

    let mut handles = Vec::new();
    for market_id in config.markets.clone() {
        let token = acquire_market_lease(&*lease, &market_id, config.lease_ttl).await?;
        info!(market = %market_id, "lease acquired");
        let handle = tokio::spawn(market_loop(
            market_id.clone(),
            token,
            Arc::clone(&config),
            strategy.clone(),
            Arc::clone(&lease),
            Arc::clone(&edge),
            Arc::clone(&oracle),
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

async fn market_loop<B, E, O>(
    market_id: String,
    token: String,
    config: Arc<QuoteAgentConfig>,
    strategy: QuoteStrategy,
    lease: Arc<B>,
    edge: Arc<E>,
    oracle: Arc<O>,
) -> Result<()>
where
    B: LeaseBackend,
    E: EdgeClient,
    O: OracleSource,
{
    let state = Arc::new(Mutex::new(OpenQuotes::default()));
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
            run_quote_iteration(&market_id, &config, &strategy, &*edge, &*oracle, &state).await
        {
            warn!(market = %market_id, %err, "quote iteration failed; will retry next tick");
        }
        tokio::time::sleep(config.poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn strategy_quotes_are_symmetric() {
        let s = QuoteStrategy::new(10);
        let (bid, ask) = s.quotes(100.0);
        assert!(bid < 100.0);
        assert!(ask > 100.0);
        // 5 bps half spread → ±0.05
        assert!((100.0 - bid - 0.05).abs() < 1e-9);
        assert!((ask - 100.0 - 0.05).abs() < 1e-9);
    }

    #[tokio::test]
    async fn first_iteration_places_bid_and_ask() {
        let cfg = QuoteAgentConfig {
            markets: vec!["btc-usd".into()],
            ..Default::default()
        };
        let strategy = QuoteStrategy::new(cfg.base_spread_bps);
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let state = Arc::new(Mutex::new(OpenQuotes::default()));

        run_quote_iteration("btc-usd", &cfg, &strategy, &edge, &oracle, &state)
            .await
            .unwrap();

        let events = edge.events();
        assert_eq!(events.len(), 2, "exactly bid + ask");
        assert!(events[0].starts_with("place buy"));
        assert!(events[1].starts_with("place sell"));
    }

    #[tokio::test]
    async fn second_iteration_cancels_when_price_moves() {
        let cfg = QuoteAgentConfig {
            markets: vec!["btc-usd".into()],
            reprice_threshold_bps: 1,
            ..Default::default()
        };
        let strategy = QuoteStrategy::new(cfg.base_spread_bps);
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let state = Arc::new(Mutex::new(OpenQuotes::default()));

        run_quote_iteration("btc-usd", &cfg, &strategy, &edge, &oracle, &state)
            .await
            .unwrap();
        // 1% move triggers reprice.
        oracle.set("btc-usd", 101_000.0);
        run_quote_iteration("btc-usd", &cfg, &strategy, &edge, &oracle, &state)
            .await
            .unwrap();

        let events = edge.events();
        // place x2, cancel x2, place x2 = 6 events
        assert_eq!(events.len(), 6, "{events:?}");
        assert!(events.iter().any(|e| e.starts_with("cancel ord_1")));
        assert!(events.iter().any(|e| e.starts_with("cancel ord_2")));
    }

    #[tokio::test]
    async fn second_iteration_skips_when_movement_below_threshold() {
        let cfg = QuoteAgentConfig {
            markets: vec!["btc-usd".into()],
            reprice_threshold_bps: 50, // tolerate moves up to 0.5%
            ..Default::default()
        };
        let strategy = QuoteStrategy::new(cfg.base_spread_bps);
        let edge = MockEdge::default();
        let oracle = StaticOracle::new(&[("btc-usd", 100_000.0)]);
        let state = Arc::new(Mutex::new(OpenQuotes::default()));

        run_quote_iteration("btc-usd", &cfg, &strategy, &edge, &oracle, &state)
            .await
            .unwrap();
        oracle.set("btc-usd", 100_100.0); // 10 bps move, under 50 bps threshold
        run_quote_iteration("btc-usd", &cfg, &strategy, &edge, &oracle, &state)
            .await
            .unwrap();

        assert_eq!(edge.events().len(), 2, "second tick is a no-op");
    }

    #[tokio::test]
    async fn lease_is_exclusive_per_market() {
        let backend = MockBackend::new();
        let first = acquire_market_lease(&backend, "btc-usd", Duration::from_secs(5))
            .await
            .unwrap();
        let second = acquire_market_lease(&backend, "btc-usd", Duration::from_secs(5)).await;
        assert!(second.is_err(), "second acquisition must fail");
        // ETH lease is independent.
        acquire_market_lease(&backend, "eth-usd", Duration::from_secs(5))
            .await
            .unwrap();
        // first token still owns the BTC slot
        assert!(!first.is_empty());
    }
}
