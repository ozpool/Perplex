//! In-memory state stores used by the API. Behind a single `AppState` so tests can build a
//! deterministic harness without standing up Postgres or Redis. Production deploys keep the
//! same shapes but back them by external stores.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use rust_decimal::Decimal;

use crate::types::{
    FillInfo, MarketInfo, OpenOrder, PositionInfo, PositionsResponse, PublicTrade,
};

/// Result of crossing a taker order against the existing resting book.
#[derive(Debug, Clone)]
pub struct MatchedFill {
    pub maker_address: String,
    pub maker_order_id: String,
    pub price: Decimal,
    pub qty: Decimal,
    pub ts_ns: u64,
}

fn scale_x18(d: Decimal) -> String {
    let scale = Decimal::from_str_exact("1000000000000000000").expect("1e18 literal parses");
    (d * scale).trunc().normalize().to_string()
}

fn scale_usdc6(d: Decimal) -> String {
    let scale = Decimal::from_str_exact("1000000").expect("1e6 literal parses");
    (d * scale).trunc().normalize().to_string()
}

fn unscale_x18(s: &str) -> Decimal {
    let raw = s.parse::<Decimal>().unwrap_or_default();
    let scale = Decimal::from_str_exact("1000000000000000000").expect("1e18 literal parses");
    if scale.is_zero() {
        Decimal::ZERO
    } else {
        raw / scale
    }
}

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
    /// Live index prices keyed by marketId, x18-scaled decimal strings. Populated
    /// by the oracle relayer when one is running; otherwise the static seed values
    /// in `markets` are returned by `market()` / `list_markets()`. Read-mostly path.
    oracle_prices: RwLock<HashMap<String, String>>,
    /// When true, auth handlers seed a fresh wallet with 100k USDC the first
    /// time they mint a JWT. Off in production — deposits must flow through
    /// the on-chain vault path — but on locally so traders can place orders
    /// without spinning up Anvil + the deposit relayer just to smoke-test.
    dev_seed_vault: bool,
}

#[derive(Default, Clone)]
pub struct BookSnapshot {
    pub sequence: u64,
    pub bids: Vec<[String; 2]>,
    pub asks: Vec<[String; 2]>,
}

/// 100,000 USDC at 6 decimals — the bankroll handed out by `seed_dev_vault`
/// when `dev_seed_vault` is on. Big enough to test 20x leverage on BTC at six
/// figures without hitting `Insufficient margin` mid-demo.
const DEV_SEED_USDC_RAW: &str = "100000000000";

impl AppState {
    pub fn new(jwt_secret: Vec<u8>) -> Self {
        Self::with_options(jwt_secret, false)
    }

    pub fn new_dev(jwt_secret: Vec<u8>) -> Self {
        Self::with_options(jwt_secret, true)
    }

    fn with_options(jwt_secret: Vec<u8>, dev_seed_vault: bool) -> Self {
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
                oracle_prices: RwLock::new(HashMap::new()),
                dev_seed_vault,
            }),
        }
    }

    /// Idempotent — seeds the address with `DEV_SEED_USDC_RAW` USDC the first
    /// time it's seen, only when `dev_seed_vault` was opted in at construction.
    pub fn seed_dev_vault(&self, address: &str) {
        if !self.inner.dev_seed_vault {
            return;
        }
        let mut vaults = self.inner.vault_balances.write();
        vaults
            .entry(address.to_string())
            .or_insert_with(|| DEV_SEED_USDC_RAW.to_string());
    }

    pub fn jwt_secret(&self) -> &[u8] {
        &self.inner.jwt_secret
    }

    pub fn list_markets(&self) -> Vec<MarketInfo> {
        let mut v: Vec<MarketInfo> = self
            .inner
            .markets
            .values()
            .cloned()
            .map(|m| self.decorate_market(m))
            .collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    pub fn market(&self, market_id: &str) -> Option<MarketInfo> {
        let m = self.inner.markets.get(market_id).cloned()?;
        Some(self.decorate_market(m))
    }

    /// Overlay live oracle price + computed stats (24h volume, open interest,
    /// funding rate, next funding boundary) onto a static MarketInfo. Called
    /// from `market()` / `list_markets()` so REST callers always see the
    /// freshest numbers without any cache invalidation.
    fn decorate_market(&self, mut m: MarketInfo) -> MarketInfo {
        if let Some(px) = self.inner.oracle_prices.read().get(&m.id) {
            m.index_price_x18 = px.clone();
        }
        m.volume_24h_usdc = self.volume_24h_usdc(&m.id);
        m.open_interest_usdc = self.open_interest_usdc(&m.id);
        m.funding_rate_bps = self.funding_rate_bps(&m.id);
        m.next_funding_ts_ns = next_funding_ts_ns(m.funding_interval_sec as u64);
        m
    }

    /// Sum |qty * price| over every public trade currently retained for this
    /// market. The trade ring is bounded so this is constant-time per market,
    /// not a true 24h scan — accurate enough for the demo dashboard until a
    /// dedicated aggregator ships.
    pub fn volume_24h_usdc(&self, market_id: &str) -> String {
        let trades = self.inner.public_trades.read();
        let Some(list) = trades.get(market_id) else {
            return "0".to_string();
        };
        let mut total = Decimal::ZERO;
        for t in list.iter() {
            let qty: Decimal = t.qty.parse().unwrap_or_default();
            let price: Decimal = t.price.parse().unwrap_or_default();
            total += (qty * price).abs();
        }
        scale_usdc6(total)
    }

    /// Open interest = sum of |size * mark| across every user's open position
    /// in this market. Mark price tracks the (overlaid) index price so OI
    /// drifts with the oracle. Returned as 6-decimal USDC raw to match the
    /// rest of the wire format.
    pub fn open_interest_usdc(&self, market_id: &str) -> String {
        let mark = self
            .market_raw(market_id)
            .map(|m| unscale_x18(&m.index_price_x18))
            .unwrap_or_default();
        // Re-apply oracle overlay so OI tracks live price.
        let mark = self
            .inner
            .oracle_prices
            .read()
            .get(market_id)
            .map(|p| unscale_x18(p))
            .unwrap_or(mark);
        if mark.is_zero() {
            return "0".to_string();
        }
        let positions = self.inner.positions.read();
        let mut total = Decimal::ZERO;
        for list in positions.values() {
            for p in list.iter() {
                if p.market_id != market_id {
                    continue;
                }
                let size: Decimal = p.size.parse().unwrap_or_default();
                total += (size * mark).abs();
            }
        }
        scale_usdc6(total)
    }

    /// Funding rate in bps derived from the orderbook mid versus the live
    /// index price: ((mid - index) / index) × 10000. Positive means longs pay
    /// shorts (book trading above index), negative the reverse. Clamped to
    /// ±100 bps so a thin book can't produce wild numbers. Falls back to 0
    /// when either side of the book is empty or the index isn't known.
    pub fn funding_rate_bps(&self, market_id: &str) -> i32 {
        let Some(m) = self.market_raw(market_id) else {
            return 0;
        };
        let index = self
            .inner
            .oracle_prices
            .read()
            .get(market_id)
            .map(|p| unscale_x18(p))
            .unwrap_or_else(|| unscale_x18(&m.index_price_x18));
        if index.is_zero() {
            return 0;
        }
        let books = self.inner.orderbooks.read();
        let Some(book) = books.get(market_id) else {
            return 0;
        };
        let best_bid = book
            .bids
            .first()
            .and_then(|lvl| lvl[0].parse::<Decimal>().ok());
        let best_ask = book
            .asks
            .first()
            .and_then(|lvl| lvl[0].parse::<Decimal>().ok());
        let (Some(bid), Some(ask)) = (best_bid, best_ask) else {
            return 0;
        };
        let mid = (bid + ask) / Decimal::from(2u32);
        let drift = (mid - index) / index * Decimal::from(10_000u32);
        use rust_decimal::prelude::ToPrimitive;
        let raw = drift.round().to_i32().unwrap_or(0);
        raw.clamp(-100, 100)
    }

    /// Internal accessor that returns the raw stored MarketInfo without any
    /// of the decorate_market overlays — used inside decorate_market itself
    /// to avoid infinite recursion when computing OI / funding.
    fn market_raw(&self, market_id: &str) -> Option<MarketInfo> {
        self.inner.markets.get(market_id).cloned()
    }

    /// Push a fresh index price for `market_id`. Subsequent calls to `market()`
    /// and `list_markets()` see the new value. Position aggregates and the
    /// `oracle.{marketId}` WS channel pick it up on the next tick. Caller is
    /// responsible for formatting `price_x18` as a 1e18-scaled decimal string.
    pub fn set_oracle_price(&self, market_id: &str, price_x18: String) {
        self.inner
            .oracle_prices
            .write()
            .insert(market_id.to_string(), price_x18);
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
        let market_id = order.market_id.clone();
        self.inner
            .open_orders
            .write()
            .entry(address.to_string())
            .or_default()
            .push(order);
        self.rebuild_orderbook(&market_id);
    }

    pub fn cancel_order(&self, address: &str, order_id: &str) -> bool {
        let mut g = self.inner.open_orders.write();
        let market_id = g
            .get(address)
            .and_then(|list| list.iter().find(|o| o.id == order_id))
            .map(|o| o.market_id.clone());
        let changed = if let Some(list) = g.get_mut(address) {
            let before = list.len();
            list.retain(|o| o.id != order_id);
            list.len() != before
        } else {
            false
        };
        drop(g);
        if let Some(mid) = market_id {
            self.rebuild_orderbook(&mid);
        }
        changed
    }

    /// Recomputes the public orderbook snapshot for `market_id` by aggregating the remaining
    /// quantity of every resting limit order across all users. Called after every
    /// `add_open_order` or `cancel_order` so the snapshot served by `/v1/orderbook/:market_id`
    /// reflects the current resting state. Market orders (price = "0") are skipped because they
    /// never rest.
    pub fn rebuild_orderbook(&self, market_id: &str) {
        let orders = self.inner.open_orders.read();
        let mut bids: BTreeMap<Decimal, Decimal> = BTreeMap::new();
        let mut asks: BTreeMap<Decimal, Decimal> = BTreeMap::new();
        for list in orders.values() {
            for o in list.iter().filter(|o| o.market_id == market_id) {
                if o.order_type != "limit" {
                    continue;
                }
                let price = match o.price.parse::<Decimal>() {
                    Ok(p) if !p.is_zero() => p,
                    _ => continue,
                };
                let qty = match o.remaining.parse::<Decimal>() {
                    Ok(q) if !q.is_zero() => q,
                    _ => continue,
                };
                let bucket = if o.side == "buy" {
                    &mut bids
                } else {
                    &mut asks
                };
                bucket.entry(price).and_modify(|v| *v += qty).or_insert(qty);
            }
        }
        drop(orders);

        let to_levels = |b: BTreeMap<Decimal, Decimal>, descending: bool| -> Vec<[String; 2]> {
            let mut v: Vec<_> = b.into_iter().collect();
            if descending {
                v.reverse();
            }
            v.into_iter()
                .map(|(p, q)| [p.normalize().to_string(), q.normalize().to_string()])
                .collect()
        };

        let mut books = self.inner.orderbooks.write();
        let entry = books.entry(market_id.to_string()).or_default();
        entry.sequence = entry.sequence.saturating_add(1);
        entry.bids = to_levels(bids, true);
        entry.asks = to_levels(asks, false);
    }

    /// Cross a taker order against the existing resting book and return the
    /// matched fills. Decrements / removes maker open orders in place. Caller
    /// is responsible for recording fills, public trades, and position updates.
    /// Always rebuilds the orderbook snapshot so subscribers see the new top
    /// of book on the next poll/frame.
    /// (bid_count, ask_count) of resting limit orders for `market_id`. Used
    /// only as a diagnostic log line in place_order so we can tell at a glance
    /// whether the bot's orders are actually in state when a taker is rejected
    /// for "no liquidity".
    pub fn resting_orders_summary(&self, market_id: &str) -> (usize, usize) {
        let orders = self.inner.open_orders.read();
        let mut bids = 0;
        let mut asks = 0;
        for list in orders.values() {
            for o in list.iter() {
                if o.market_id != market_id || o.order_type != "limit" {
                    continue;
                }
                let has_remaining = o
                    .remaining
                    .parse::<Decimal>()
                    .map(|r| !r.is_zero())
                    .unwrap_or(false);
                if !has_remaining {
                    continue;
                }
                match o.side.as_str() {
                    "buy" => bids += 1,
                    "sell" => asks += 1,
                    _ => {}
                }
            }
        }
        (bids, asks)
    }

    /// Read-only sibling of `match_taker`: returns the quantity that *would*
    /// match without mutating any state. Used by the post_only guard so we can
    /// reject crossing orders before they decrement maker books.
    pub fn match_taker_probe(
        &self,
        market_id: &str,
        taker_side: &str,
        taker_price: Option<Decimal>,
        taker_qty: Decimal,
        taker_address: &str,
    ) -> Decimal {
        let opp_side = if taker_side == "buy" { "sell" } else { "buy" };
        let orders = self.inner.open_orders.read();
        let mut remaining = taker_qty;
        let mut filled = Decimal::ZERO;
        // Walk every candidate maker; price-time ordering doesn't change
        // *total* match qty so we skip the sort.
        for (addr, list) in orders.iter() {
            // Self-trade prevention: a wallet must never cross its own
            // resting orders. Without this, taker + maker upserts on the
            // same address net to zero and the user's position vanishes
            // the instant they trade through one of their own limits.
            if addr == taker_address {
                continue;
            }
            for o in list.iter() {
                if remaining.is_zero() {
                    return filled;
                }
                if o.market_id != market_id || o.side != opp_side || o.order_type != "limit" {
                    continue;
                }
                let price = match o.price.parse::<Decimal>() {
                    Ok(p) if !p.is_zero() => p,
                    _ => continue,
                };
                let rem = match o.remaining.parse::<Decimal>() {
                    Ok(r) if !r.is_zero() => r,
                    _ => continue,
                };
                if let Some(tp) = taker_price {
                    if taker_side == "buy" && price > tp {
                        continue;
                    }
                    if taker_side == "sell" && price < tp {
                        continue;
                    }
                }
                let take = remaining.min(rem);
                filled += take;
                remaining -= take;
            }
        }
        filled
    }

    pub fn match_taker(
        &self,
        market_id: &str,
        taker_side: &str,
        taker_price: Option<Decimal>,
        taker_qty: Decimal,
        taker_address: &str,
    ) -> Vec<MatchedFill> {
        let opp_side = if taker_side == "buy" { "sell" } else { "buy" };

        // Phase 1 — read-only candidate collection.
        let mut candidates: Vec<(String, String, Decimal, Decimal, u64)> = {
            let orders = self.inner.open_orders.read();
            let mut out = vec![];
            for (addr, list) in orders.iter() {
                // Self-trade prevention: skip every maker order owned by
                // the same wallet as the taker. See match_taker_probe for
                // the failure mode this guards against.
                if addr == taker_address {
                    continue;
                }
                for o in list.iter() {
                    if o.market_id != market_id || o.side != opp_side || o.order_type != "limit" {
                        continue;
                    }
                    let price = match o.price.parse::<Decimal>() {
                        Ok(p) if !p.is_zero() => p,
                        _ => continue,
                    };
                    let rem = match o.remaining.parse::<Decimal>() {
                        Ok(r) if !r.is_zero() => r,
                        _ => continue,
                    };
                    if let Some(tp) = taker_price {
                        if taker_side == "buy" && price > tp {
                            continue;
                        }
                        if taker_side == "sell" && price < tp {
                            continue;
                        }
                    }
                    let ts: u64 = o.ts_ns.parse().unwrap_or(0);
                    out.push((addr.clone(), o.id.clone(), price, rem, ts));
                }
            }
            // Price-time priority: best price first, oldest first within a price.
            if taker_side == "buy" {
                out.sort_by(|a, b| a.2.cmp(&b.2).then(a.4.cmp(&b.4)));
            } else {
                out.sort_by(|a, b| b.2.cmp(&a.2).then(a.4.cmp(&b.4)));
            }
            out
        };

        // Phase 2 — decrement matched maker orders under a write lock.
        let mut filled = vec![];
        let mut remaining = taker_qty;
        {
            let mut orders = self.inner.open_orders.write();
            for (maker_addr, maker_id, price, _, _) in candidates.drain(..) {
                if remaining.is_zero() {
                    break;
                }
                let Some(list) = orders.get_mut(&maker_addr) else {
                    continue;
                };
                let Some(order) = list.iter_mut().find(|o| o.id == maker_id) else {
                    continue;
                };
                let maker_rem: Decimal = match order.remaining.parse() {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                if maker_rem.is_zero() {
                    continue;
                }
                let fill_qty = remaining.min(maker_rem);
                let new_rem = maker_rem - fill_qty;
                order.remaining = new_rem.normalize().to_string();
                filled.push(MatchedFill {
                    maker_address: maker_addr,
                    maker_order_id: maker_id,
                    price,
                    qty: fill_qty,
                    ts_ns: now_ns(),
                });
                remaining -= fill_qty;
            }
            // Reap fully filled maker orders in this market.
            for list in orders.values_mut() {
                list.retain(|o| {
                    o.market_id != market_id
                        || o.remaining
                            .parse::<Decimal>()
                            .map(|r| !r.is_zero())
                            .unwrap_or(true)
                });
            }
        }

        // Phase 3 — refresh the public orderbook snapshot.
        self.rebuild_orderbook(market_id);

        filled
    }

    /// Apply a fill to a trader's position book. Same-side fills increase size
    /// at the volume-weighted entry price. Opposite-side fills reduce the
    /// existing position (and remove it when fully closed) or flip it when
    /// the new qty exceeds the resting size. Mark price tracks entry until an
    /// oracle relayer is wired - good enough to render the position panel.
    pub fn upsert_position(
        &self,
        address: &str,
        market_id: &str,
        order_side: &str,
        qty: Decimal,
        price: Decimal,
    ) {
        let new_side = if order_side == "buy" { "long" } else { "short" };
        tracing::info!(
            %address,
            market = %market_id,
            order_side,
            qty = %qty,
            price = %price,
            "upsert_position"
        );
        let mut positions = self.inner.positions.write();
        let list = positions.entry(address.to_string()).or_default();
        let idx = list.iter().position(|p| p.market_id == market_id);
        let Some(i) = idx else {
            list.push(PositionInfo {
                market_id: market_id.to_string(),
                size: qty.normalize().to_string(),
                side: new_side.to_string(),
                entry_price_x18: scale_x18(price),
                mark_price_x18: scale_x18(price),
                notional_usdc: scale_usdc6(qty * price),
                unrealised_pnl_usdc: "0".into(),
                realised_pnl_usdc: "0".into(),
                leverage: "1".into(),
                liquidation_price_x18: "0".into(),
                funding_paid_usdc: "0".into(),
                last_updated_ts_ns: now_ns().to_string(),
            });
            return;
        };

        let old_size: Decimal = list[i].size.parse().unwrap_or_default();
        let old_entry = unscale_x18(&list[i].entry_price_x18);

        let ts = now_ns().to_string();
        if list[i].side == new_side {
            // Same-side add: volume-weighted entry.
            let new_size = old_size + qty;
            let new_entry = if !new_size.is_zero() {
                (old_size * old_entry + qty * price) / new_size
            } else {
                price
            };
            let p = &mut list[i];
            p.size = new_size.normalize().to_string();
            p.entry_price_x18 = scale_x18(new_entry);
            p.mark_price_x18 = scale_x18(new_entry);
            p.notional_usdc = scale_usdc6(new_size * new_entry);
            p.last_updated_ts_ns = ts;
            return;
        }

        // Opposite side -> reduce or flip.
        if qty < old_size {
            let new_size = old_size - qty;
            let p = &mut list[i];
            p.size = new_size.normalize().to_string();
            p.notional_usdc = scale_usdc6(new_size * old_entry);
            p.last_updated_ts_ns = ts;
            return;
        }
        if qty == old_size {
            // Fully closed.
            list.remove(i);
            return;
        }
        // Flip: the overflow becomes the new position on the opposite side.
        let overflow = qty - old_size;
        let p = &mut list[i];
        p.side = new_side.to_string();
        p.size = overflow.normalize().to_string();
        p.entry_price_x18 = scale_x18(price);
        p.mark_price_x18 = scale_x18(price);
        p.notional_usdc = scale_usdc6(overflow * price);
        p.last_updated_ts_ns = ts;
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

    /// Build a fully-populated PositionsResponse, including per-position
    /// mark + PnL recomputed from current index prices and the cross-margin
    /// aggregates (total notional, total unrealised PnL, used margin, free
    /// collateral). Stored positions only carry the entry-time snapshot;
    /// without this pass the Portfolio page shows 0/$0 across the board
    /// because the handler was emitting the raw stored fields.
    pub fn account_summary(&self, address: &str) -> PositionsResponse {
        let usdc_scale = Decimal::from(1_000_000u64);
        let bps_scale = Decimal::from(10_000u64);

        let mut positions = self.positions_for(address);
        let collateral_str = self.vault_balance(address);
        let collateral_dollars = collateral_str
            .parse::<Decimal>()
            .unwrap_or_default()
            / usdc_scale;

        let mut total_notional = Decimal::ZERO;
        let mut total_pnl = Decimal::ZERO;
        let mut used_margin = Decimal::ZERO;

        for p in positions.iter_mut() {
            let size: Decimal = p.size.parse().unwrap_or_default();
            if size.is_zero() {
                continue;
            }
            let entry = unscale_x18(&p.entry_price_x18);
            // Mark price tracks the market's static index price until an
            // oracle relayer is wired (see /v1/markets seed values). Good
            // enough to surface a non-zero PnL the instant the user opens a
            // position; once the relayer ships this pulls from a live feed.
            let mark = match self.market(&p.market_id) {
                Some(m) => unscale_x18(&m.index_price_x18),
                None => entry,
            };
            let im_ratio_bps = self
                .market(&p.market_id)
                .map(|m| Decimal::from(m.im_ratio_bps as u64))
                .unwrap_or_else(|| Decimal::from(500u64));
            let im_ratio = im_ratio_bps / bps_scale;

            let notional = size * mark;
            let pnl = if p.side == "long" {
                size * (mark - entry)
            } else {
                size * (entry - mark)
            };
            let im = notional * im_ratio;

            p.mark_price_x18 = scale_x18(mark);
            p.unrealised_pnl_usdc = scale_usdc6(pnl);
            p.notional_usdc = scale_usdc6(notional);

            total_notional += notional;
            total_pnl += pnl;
            used_margin += im;
        }

        let free = {
            let raw = collateral_dollars + total_pnl - used_margin;
            if raw < Decimal::ZERO { Decimal::ZERO } else { raw }
        };

        PositionsResponse {
            collateral_usdc: collateral_str,
            free_collateral_usdc: scale_usdc6(free),
            total_unrealised_pnl_usdc: scale_usdc6(total_pnl),
            total_notional_usdc: scale_usdc6(total_notional),
            positions,
        }
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

/// Next funding settlement boundary as nanoseconds since the Unix epoch.
/// Aligned to `interval_sec` so the FE countdown is stable across reads
/// — e.g. with 28800s (8h) settlements the value advances only at 00:00,
/// 08:00, 16:00 UTC.
pub fn next_funding_ts_ns(interval_sec: u64) -> String {
    if interval_sec == 0 {
        return "0".to_string();
    }
    let now_sec = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let next_sec = ((now_sec / interval_sec) + 1) * interval_sec;
    ((next_sec as u128) * 1_000_000_000u128).to_string()
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
            volume_24h_usdc: "0".into(),
            open_interest_usdc: "0".into(),
            funding_rate_bps: 0,
            next_funding_ts_ns: "0".into(),
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
            volume_24h_usdc: "0".into(),
            open_interest_usdc: "0".into(),
            funding_rate_bps: 0,
            next_funding_ts_ns: "0".into(),
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
            // 200e18 — matches `prices[2]` in contracts/script/Deploy.s.sol::_seedPrices
            // so the edge default agrees with the on-chain oracle on a fresh `make dev-up`.
            // Bumped from 150e18; see #95.
            index_price_x18: "200000000000000000000".into(),
            volume_24h_usdc: "0".into(),
            open_interest_usdc: "0".into(),
            funding_rate_bps: 0,
            next_funding_ts_ns: "0".into(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn order(id: &str, side: &str, price: &str, remaining: &str) -> OpenOrder {
        OpenOrder {
            id: id.into(),
            market_id: "btc-usd".into(),
            side: side.into(),
            order_type: "limit".into(),
            price: price.into(),
            qty: remaining.into(),
            remaining: remaining.into(),
            ts_ns: "0".into(),
            client_order_id: None,
        }
    }

    #[test]
    fn place_rebuilds_snapshot_with_bid_and_ask() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xmaker", order("o1", "buy", "99950", "0.1"));
        state.add_open_order("0xtaker", order("o2", "sell", "100050", "0.2"));
        let snap = state.orderbook("btc-usd").expect("snapshot exists");
        assert_eq!(snap.bids, vec![["99950".to_string(), "0.1".to_string()]]);
        assert_eq!(snap.asks, vec![["100050".to_string(), "0.2".to_string()]]);
        assert!(snap.sequence >= 2);
    }

    #[test]
    fn rebuild_sums_quantity_at_same_price() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xa", order("o1", "buy", "99950", "0.1"));
        state.add_open_order("0xb", order("o2", "buy", "99950", "0.4"));
        let snap = state.orderbook("btc-usd").unwrap();
        assert_eq!(snap.bids, vec![["99950".to_string(), "0.5".to_string()]]);
    }

    #[test]
    fn rebuild_sorts_bids_desc_asks_asc() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xa", order("o1", "buy", "99000", "0.1"));
        state.add_open_order("0xa", order("o2", "buy", "99500", "0.1"));
        state.add_open_order("0xa", order("o3", "sell", "101000", "0.1"));
        state.add_open_order("0xa", order("o4", "sell", "100500", "0.1"));
        let snap = state.orderbook("btc-usd").unwrap();
        assert_eq!(
            snap.bids,
            vec![
                ["99500".to_string(), "0.1".to_string()],
                ["99000".to_string(), "0.1".to_string()],
            ]
        );
        assert_eq!(
            snap.asks,
            vec![
                ["100500".to_string(), "0.1".to_string()],
                ["101000".to_string(), "0.1".to_string()],
            ]
        );
    }

    #[test]
    fn cancel_removes_order_from_snapshot() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xa", order("o1", "buy", "99950", "0.1"));
        state.add_open_order("0xa", order("o2", "buy", "99950", "0.4"));
        assert!(state.cancel_order("0xa", "o2"));
        let snap = state.orderbook("btc-usd").unwrap();
        assert_eq!(snap.bids, vec![["99950".to_string(), "0.1".to_string()]]);
    }

    #[test]
    fn match_taker_crosses_resting_ask() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xmaker", order("o1", "sell", "100050", "0.05"));
        let matches = state.match_taker(
            "btc-usd",
            "buy",
            Some(Decimal::from_str_exact("100050").unwrap()),
            Decimal::from_str_exact("0.01").unwrap(),
            "0xtaker",
        );
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].maker_address, "0xmaker");
        assert_eq!(matches[0].price.normalize().to_string(), "100050");
        assert_eq!(matches[0].qty.normalize().to_string(), "0.01");
        // Maker still has 0.04 resting -> snapshot reflects it
        let snap = state.orderbook("btc-usd").unwrap();
        assert_eq!(snap.asks, vec![["100050".to_string(), "0.04".to_string()]]);
    }

    #[test]
    fn market_taker_walks_best_price_first() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xa", order("o1", "sell", "100200", "0.05"));
        state.add_open_order("0xb", order("o2", "sell", "100050", "0.03"));
        let matches = state.match_taker(
            "btc-usd",
            "buy",
            None, // market
            Decimal::from_str_exact("0.05").unwrap(),
            "0xtaker",
        );
        assert_eq!(matches.len(), 2);
        // Best ask first
        assert_eq!(matches[0].price.normalize().to_string(), "100050");
        assert_eq!(matches[0].qty.normalize().to_string(), "0.03");
        assert_eq!(matches[1].price.normalize().to_string(), "100200");
        assert_eq!(matches[1].qty.normalize().to_string(), "0.02");
    }

    #[test]
    fn limit_taker_does_not_cross_below_price() {
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xmaker", order("o1", "sell", "100050", "0.05"));
        let matches = state.match_taker(
            "btc-usd",
            "buy",
            Some(Decimal::from_str_exact("100000").unwrap()),
            Decimal::from_str_exact("0.01").unwrap(),
            "0xtaker",
        );
        assert!(matches.is_empty());
    }

    #[test]
    fn match_taker_skips_self_owned_maker_orders() {
        // A wallet must never cross its own resting limits. If it did, the
        // upsert_position calls for taker (+long) and maker (-short) would
        // run against the same address and net to zero, deleting the
        // position. This is exactly what bit us during the demo run on
        // 2026-05-27 (PR #145).
        let state = AppState::new(b"test".to_vec());
        state.add_open_order("0xself", order("self-ask", "sell", "100050", "0.05"));
        state.add_open_order("0xother", order("other-ask", "sell", "100100", "0.05"));
        let matches = state.match_taker(
            "btc-usd",
            "buy",
            Some(Decimal::from_str_exact("100200").unwrap()),
            Decimal::from_str_exact("0.05").unwrap(),
            "0xself",
        );
        // Self-owned ask is skipped; only the other-owned one matches.
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].maker_address, "0xother");
    }

    #[test]
    fn upsert_position_opens_then_averages_then_closes() {
        let state = AppState::new(b"test".to_vec());
        // Open long 0.1 @ 100000
        state.upsert_position(
            "0xtaker",
            "btc-usd",
            "buy",
            Decimal::from_str_exact("0.1").unwrap(),
            Decimal::from_str_exact("100000").unwrap(),
        );
        let p1 = &state.positions_for("0xtaker")[0];
        assert_eq!(p1.side, "long");
        assert_eq!(p1.size, "0.1");
        // Add 0.1 @ 102000 -> avg 101000
        state.upsert_position(
            "0xtaker",
            "btc-usd",
            "buy",
            Decimal::from_str_exact("0.1").unwrap(),
            Decimal::from_str_exact("102000").unwrap(),
        );
        let p2 = &state.positions_for("0xtaker")[0];
        assert_eq!(p2.size, "0.2");
        assert_eq!(
            unscale_x18(&p2.entry_price_x18).normalize().to_string(),
            "101000"
        );
        // Close fully with sell 0.2
        state.upsert_position(
            "0xtaker",
            "btc-usd",
            "sell",
            Decimal::from_str_exact("0.2").unwrap(),
            Decimal::from_str_exact("101000").unwrap(),
        );
        assert!(state.positions_for("0xtaker").is_empty());
    }

    #[test]
    fn market_orders_do_not_rest_in_snapshot() {
        let state = AppState::new(b"test".to_vec());
        let mut market = order("o1", "buy", "0", "0.1");
        market.order_type = "market".into();
        state.add_open_order("0xa", market);
        let snap = state.orderbook("btc-usd").unwrap();
        assert!(snap.bids.is_empty());
        assert!(snap.asks.is_empty());
    }
}
