//! In-memory state stores used by the API. Behind a single `AppState` so tests can build a
//! deterministic harness without standing up Postgres or Redis. Production deploys keep the
//! same shapes but back them by external stores.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;

use crate::types::{FillInfo, MarketInfo, OpenOrder, PositionInfo, PublicTrade};

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    /// Static market metadata keyed by marketId.
    markets: HashMap<String, MarketInfo>,
    /// Per-market orderbook snapshot (price → qty).
    orderbooks: RwLock<HashMap<String, BookSnapshot>>,
    /// Bounded ring of recent public trades per market.
    public_trades: RwLock<HashMap<String, Vec<PublicTrade>>>,
    /// Open orders keyed by user address.
    open_orders: RwLock<HashMap<String, Vec<OpenOrder>>>,
    /// User positions keyed by user address.
    positions: RwLock<HashMap<String, Vec<PositionInfo>>>,
    /// Fills history keyed by user address.
    fills: RwLock<HashMap<String, Vec<FillInfo>>>,
    /// USDC vault balance keyed by user address (6-decimal raw, encoded as decimal string).
    vault_balances: RwLock<HashMap<String, String>>,
    /// Active SIWE nonces issued, keyed by address.
    siwe_nonces: RwLock<HashMap<String, String>>,
    /// JWT signing secret. Generated per-process in dev; injected from env in prod.
    pub jwt_secret: Vec<u8>,
    /// Funding history keyed by marketId.
    funding_history: RwLock<HashMap<String, Vec<(u64, f64)>>>,
}

#[derive(Default, Clone)]
pub struct BookSnapshot {
    pub sequence: u64,
    pub bids: Vec<[String; 2]>,
    pub asks: Vec<[String; 2]>,
}

impl AppState {
    pub fn new(jwt_secret: Vec<u8>) -> Self {
        Self {
            inner: Arc::new(Inner {
                markets: default_markets(),
                orderbooks: RwLock::new(default_books()),
                public_trades: RwLock::new(HashMap::new()),
                open_orders: RwLock::new(HashMap::new()),
                positions: RwLock::new(HashMap::new()),
                fills: RwLock::new(HashMap::new()),
                vault_balances: RwLock::new(HashMap::new()),
                siwe_nonces: RwLock::new(HashMap::new()),
                jwt_secret,
                funding_history: RwLock::new(HashMap::new()),
            }),
        }
    }

    pub fn jwt_secret(&self) -> &[u8] {
        &self.inner.jwt_secret
    }

    pub fn list_markets(&self) -> Vec<MarketInfo> {
        let mut v: Vec<_> = self.inner.markets.values().cloned().collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    pub fn market(&self, market_id: &str) -> Option<MarketInfo> {
        self.inner.markets.get(market_id).cloned()
    }

    pub fn orderbook(&self, market_id: &str) -> Option<BookSnapshot> {
        self.inner.orderbooks.read().get(market_id).cloned()
    }

    pub fn set_orderbook(&self, market_id: &str, snap: BookSnapshot) {
        self.inner
            .orderbooks
            .write()
            .insert(market_id.to_string(), snap);
    }

    pub fn public_trades(&self, market_id: &str, limit: usize) -> Vec<PublicTrade> {
        self.inner
            .public_trades
            .read()
            .get(market_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(limit)
            .collect()
    }

    pub fn record_trade(&self, market_id: &str, trade: PublicTrade) {
        self.inner
            .public_trades
            .write()
            .entry(market_id.to_string())
            .or_default()
            .push(trade);
    }

    pub fn open_orders_for(&self, address: &str) -> Vec<OpenOrder> {
        self.inner
            .open_orders
            .read()
            .get(address)
            .cloned()
            .unwrap_or_default()
    }

    pub fn add_open_order(&self, address: &str, order: OpenOrder) {
        self.inner
            .open_orders
            .write()
            .entry(address.to_string())
            .or_default()
            .push(order);
    }

    pub fn cancel_order(&self, address: &str, order_id: &str) -> bool {
        let mut g = self.inner.open_orders.write();
        if let Some(list) = g.get_mut(address) {
            let before = list.len();
            list.retain(|o| o.id != order_id);
            return list.len() != before;
        }
        false
    }

    pub fn positions_for(&self, address: &str) -> Vec<PositionInfo> {
        self.inner
            .positions
            .read()
            .get(address)
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_positions(&self, address: &str, positions: Vec<PositionInfo>) {
        self.inner
            .positions
            .write()
            .insert(address.to_string(), positions);
    }

    pub fn fills_for(&self, address: &str, limit: usize) -> Vec<FillInfo> {
        self.inner
            .fills
            .read()
            .get(address)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(limit)
            .collect()
    }

    pub fn record_fill(&self, address: &str, fill: FillInfo) {
        self.inner
            .fills
            .write()
            .entry(address.to_string())
            .or_default()
            .push(fill);
    }

    pub fn vault_balance(&self, address: &str) -> String {
        self.inner
            .vault_balances
            .read()
            .get(address)
            .cloned()
            .unwrap_or_else(|| "0".to_string())
    }

    pub fn set_vault_balance(&self, address: &str, amount: String) {
        self.inner
            .vault_balances
            .write()
            .insert(address.to_string(), amount);
    }

    pub fn issue_siwe_nonce(&self, address: &str) -> String {
        let nonce = ulid::Ulid::new().to_string();
        self.inner
            .siwe_nonces
            .write()
            .insert(address.to_string(), nonce.clone());
        nonce
    }

    pub fn consume_siwe_nonce(&self, address: &str) -> Option<String> {
        self.inner.siwe_nonces.write().remove(address)
    }

    pub fn record_funding_point(&self, market_id: &str, ts_ns: u64, rate_bps: f64) {
        self.inner
            .funding_history
            .write()
            .entry(market_id.to_string())
            .or_default()
            .push((ts_ns, rate_bps));
    }

    pub fn funding_history(&self, market_id: &str) -> Vec<(u64, f64)> {
        self.inner
            .funding_history
            .read()
            .get(market_id)
            .cloned()
            .unwrap_or_default()
    }
}

pub fn now_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos() as u64
}

fn default_markets() -> HashMap<String, MarketInfo> {
    let mut m = HashMap::new();
    m.insert(
        "btc-usd".into(),
        MarketInfo {
            id: "btc-usd".into(),
            base: "BTC".into(),
            quote: "USD".into(),
            active: true,
            tick_size: "0.1".into(),
            lot_size: "0.0001".into(),
            max_leverage: 20,
            im_ratio_bps: 500,
            mm_ratio_bps: 250,
            liq_bonus_bps: 100,
            taker_fee_bps: 5,
            maker_rebate_bps: -2,
            funding_interval_sec: 28_800,
            index_price_x18: "100000000000000000000000".into(),
        },
    );
    m.insert(
        "eth-usd".into(),
        MarketInfo {
            id: "eth-usd".into(),
            base: "ETH".into(),
            quote: "USD".into(),
            active: true,
            tick_size: "0.01".into(),
            lot_size: "0.001".into(),
            max_leverage: 20,
            im_ratio_bps: 500,
            mm_ratio_bps: 250,
            liq_bonus_bps: 100,
            taker_fee_bps: 5,
            maker_rebate_bps: -2,
            funding_interval_sec: 28_800,
            index_price_x18: "3500000000000000000000".into(),
        },
    );
    m.insert(
        "sol-usd".into(),
        MarketInfo {
            id: "sol-usd".into(),
            base: "SOL".into(),
            quote: "USD".into(),
            active: true,
            tick_size: "0.001".into(),
            lot_size: "0.01".into(),
            max_leverage: 10,
            im_ratio_bps: 1_000,
            mm_ratio_bps: 500,
            liq_bonus_bps: 150,
            taker_fee_bps: 5,
            maker_rebate_bps: -2,
            funding_interval_sec: 28_800,
            index_price_x18: "150000000000000000000".into(),
        },
    );
    m
}

fn default_books() -> HashMap<String, BookSnapshot> {
    let mut m = HashMap::new();
    for id in ["btc-usd", "eth-usd", "sol-usd"] {
        m.insert(
            id.to_string(),
            BookSnapshot {
                sequence: 0,
                bids: vec![],
                asks: vec![],
            },
        );
    }
    m
}
