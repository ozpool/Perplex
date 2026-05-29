//! Postgres-backed durability for `AppState`. The in-memory stores stay the
//! authoritative read path (hot, lock-guarded, sync); this module mirrors every
//! mutation to Postgres so a restart rehydrates instead of starting empty.
//!
//! Mutators are sync (they run under `parking_lot` locks and from background
//! tickers) while sqlx is async, so we cannot `.await` inside them. Instead each
//! mutator emits a [`PersistEvent`] onto an unbounded channel and a single
//! background writer task ([`spawn_writer`]) drains it and applies the SQL in
//! order. Reads never touch Postgres — only boot (`load_snapshot`) and the
//! writer do.

use std::collections::HashMap;

use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

use crate::types::{FillInfo, OpenOrder, PositionInfo, PublicTrade};

/// A single durable mutation. Emitted by `AppState` mutators, applied by the
/// writer task. Variants map to the in-memory stores that must survive restart.
#[derive(Debug, Clone)]
pub enum PersistEvent {
    /// A new resting order (the leftover after matching) was added.
    UpsertOrder { address: String, order: OpenOrder },
    /// A single order was cancelled.
    DeleteOrder { id: String },
    /// An address's full order list changed (matching decremented/reaped
    /// several makers at once); replace its rows wholesale.
    SyncOrders {
        address: String,
        orders: Vec<OpenOrder>,
    },
    /// Append a fill to an address's history.
    InsertFill { address: String, fill: FillInfo },
    /// An address's position book changed; replace its rows wholesale (a flip
    /// or close mutates multiple fields, so a full sync is simplest + correct).
    SyncPositions {
        address: String,
        positions: Vec<PositionInfo>,
    },
    /// Set an address's vault balance.
    UpsertVault { address: String, amount: String },
    /// Append a trade to the public tape.
    InsertTrade { trade: PublicTrade },
    /// Append a funding-rate sample for a market.
    InsertFunding {
        market_id: String,
        ts_ns: u64,
        rate_bps: f64,
    },
}

/// Everything loaded from Postgres at boot, grouped to match the in-memory maps.
#[derive(Default)]
pub struct DbSnapshot {
    pub open_orders: HashMap<String, Vec<OpenOrder>>,
    pub positions: HashMap<String, Vec<PositionInfo>>,
    pub fills: HashMap<String, Vec<FillInfo>>,
    pub vault_balances: HashMap<String, String>,
    pub public_trades: HashMap<String, Vec<PublicTrade>>,
    pub funding_history: HashMap<String, Vec<(u64, f64)>>,
}

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

impl Db {
    /// Open a pool and apply the schema. The schema is idempotent
    /// (`CREATE TABLE IF NOT EXISTS`) so this is safe to run on every boot.
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new().max_connections(8).connect(url).await?;
        sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
            .execute(&pool)
            .await?;
        Ok(Self { pool })
    }

    /// Load the whole durable state into memory, grouped by the in-memory key
    /// (address for user state, market for tape/funding). Insertion order is
    /// preserved via the `seq` columns so fills/trades rehydrate in the same
    /// order they were recorded.
    pub async fn load_snapshot(&self) -> anyhow::Result<DbSnapshot> {
        let mut snap = DbSnapshot::default();

        let rows = sqlx::query(
            "SELECT id, address, market_id, side, order_type, price, qty, remaining, ts_ns, client_order_id FROM open_orders",
        )
        .fetch_all(&self.pool)
        .await?;
        for r in rows {
            let address: String = r.get("address");
            snap.open_orders
                .entry(address)
                .or_default()
                .push(OpenOrder {
                    id: r.get("id"),
                    market_id: r.get("market_id"),
                    side: r.get("side"),
                    order_type: r.get("order_type"),
                    price: r.get("price"),
                    qty: r.get("qty"),
                    remaining: r.get("remaining"),
                    ts_ns: r.get("ts_ns"),
                    client_order_id: r.get("client_order_id"),
                });
        }

        let rows = sqlx::query(
            "SELECT address, market_id, size, side, entry_price_x18, mark_price_x18, notional_usdc, unrealised_pnl_usdc, realised_pnl_usdc, leverage, liquidation_price_x18, funding_paid_usdc, last_updated_ts_ns FROM positions",
        )
        .fetch_all(&self.pool)
        .await?;
        for r in rows {
            let address: String = r.get("address");
            snap.positions
                .entry(address)
                .or_default()
                .push(PositionInfo {
                    market_id: r.get("market_id"),
                    size: r.get("size"),
                    side: r.get("side"),
                    entry_price_x18: r.get("entry_price_x18"),
                    mark_price_x18: r.get("mark_price_x18"),
                    notional_usdc: r.get("notional_usdc"),
                    unrealised_pnl_usdc: r.get("unrealised_pnl_usdc"),
                    realised_pnl_usdc: r.get("realised_pnl_usdc"),
                    leverage: r.get("leverage"),
                    liquidation_price_x18: r.get("liquidation_price_x18"),
                    funding_paid_usdc: r.get("funding_paid_usdc"),
                    last_updated_ts_ns: r.get("last_updated_ts_ns"),
                });
        }

        let rows = sqlx::query(
            "SELECT id, address, order_id, market_id, side, price, qty, fee_usdc, role, ts_ns, tx_hash FROM fills ORDER BY seq ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        for r in rows {
            let address: String = r.get("address");
            snap.fills.entry(address).or_default().push(FillInfo {
                id: r.get("id"),
                order_id: r.get("order_id"),
                market_id: r.get("market_id"),
                side: r.get("side"),
                price: r.get("price"),
                qty: r.get("qty"),
                fee_usdc: r.get("fee_usdc"),
                role: r.get("role"),
                ts_ns: r.get("ts_ns"),
                tx_hash: r.get("tx_hash"),
            });
        }

        let rows = sqlx::query("SELECT address, amount FROM vault_balances")
            .fetch_all(&self.pool)
            .await?;
        for r in rows {
            snap.vault_balances
                .insert(r.get("address"), r.get("amount"));
        }

        let rows = sqlx::query(
            "SELECT id, market_id, price, qty, side, ts_ns FROM public_trades ORDER BY seq ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        for r in rows {
            let market_id: String = r.get("market_id");
            snap.public_trades
                .entry(market_id.clone())
                .or_default()
                .push(PublicTrade {
                    id: r.get("id"),
                    market_id,
                    price: r.get("price"),
                    qty: r.get("qty"),
                    side: r.get("side"),
                    ts_ns: r.get("ts_ns"),
                });
        }

        let rows = sqlx::query(
            "SELECT market_id, ts_ns, rate_bps FROM funding_history ORDER BY ts_ns ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        for r in rows {
            let market_id: String = r.get("market_id");
            let ts_ns: i64 = r.get("ts_ns");
            let rate_bps: f64 = r.get("rate_bps");
            snap.funding_history
                .entry(market_id)
                .or_default()
                .push((ts_ns as u64, rate_bps));
        }

        Ok(snap)
    }

    /// Apply one durable mutation. Idempotent where it can be: upserts use
    /// `ON CONFLICT DO UPDATE`, the sync variants delete-then-insert under a
    /// transaction so a partially-applied sync can't leave stale rows.
    pub async fn apply(&self, ev: &PersistEvent) -> anyhow::Result<()> {
        match ev {
            PersistEvent::UpsertOrder { address, order } => {
                upsert_order(&self.pool, address, order).await?;
            }
            PersistEvent::DeleteOrder { id } => {
                sqlx::query("DELETE FROM open_orders WHERE id = $1")
                    .bind(id)
                    .execute(&self.pool)
                    .await?;
            }
            PersistEvent::SyncOrders { address, orders } => {
                let mut tx = self.pool.begin().await?;
                sqlx::query("DELETE FROM open_orders WHERE address = $1")
                    .bind(address)
                    .execute(&mut *tx)
                    .await?;
                for order in orders {
                    sqlx::query(
                        "INSERT INTO open_orders (id, address, market_id, side, order_type, price, qty, remaining, ts_ns, client_order_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
                    )
                    .bind(&order.id)
                    .bind(address)
                    .bind(&order.market_id)
                    .bind(&order.side)
                    .bind(&order.order_type)
                    .bind(&order.price)
                    .bind(&order.qty)
                    .bind(&order.remaining)
                    .bind(&order.ts_ns)
                    .bind(&order.client_order_id)
                    .execute(&mut *tx)
                    .await?;
                }
                tx.commit().await?;
            }
            PersistEvent::InsertFill { address, fill } => {
                sqlx::query(
                    "INSERT INTO fills (id, address, order_id, market_id, side, price, qty, fee_usdc, role, ts_ns, tx_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING",
                )
                .bind(&fill.id)
                .bind(address)
                .bind(&fill.order_id)
                .bind(&fill.market_id)
                .bind(&fill.side)
                .bind(&fill.price)
                .bind(&fill.qty)
                .bind(&fill.fee_usdc)
                .bind(&fill.role)
                .bind(&fill.ts_ns)
                .bind(&fill.tx_hash)
                .execute(&self.pool)
                .await?;
            }
            PersistEvent::SyncPositions { address, positions } => {
                let mut tx = self.pool.begin().await?;
                sqlx::query("DELETE FROM positions WHERE address = $1")
                    .bind(address)
                    .execute(&mut *tx)
                    .await?;
                for p in positions {
                    sqlx::query(
                        "INSERT INTO positions (address, market_id, size, side, entry_price_x18, mark_price_x18, notional_usdc, unrealised_pnl_usdc, realised_pnl_usdc, leverage, liquidation_price_x18, funding_paid_usdc, last_updated_ts_ns) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
                    )
                    .bind(address)
                    .bind(&p.market_id)
                    .bind(&p.size)
                    .bind(&p.side)
                    .bind(&p.entry_price_x18)
                    .bind(&p.mark_price_x18)
                    .bind(&p.notional_usdc)
                    .bind(&p.unrealised_pnl_usdc)
                    .bind(&p.realised_pnl_usdc)
                    .bind(&p.leverage)
                    .bind(&p.liquidation_price_x18)
                    .bind(&p.funding_paid_usdc)
                    .bind(&p.last_updated_ts_ns)
                    .execute(&mut *tx)
                    .await?;
                }
                tx.commit().await?;
            }
            PersistEvent::UpsertVault { address, amount } => {
                sqlx::query(
                    "INSERT INTO vault_balances (address, amount) VALUES ($1,$2) ON CONFLICT (address) DO UPDATE SET amount = EXCLUDED.amount",
                )
                .bind(address)
                .bind(amount)
                .execute(&self.pool)
                .await?;
            }
            PersistEvent::InsertTrade { trade } => {
                sqlx::query(
                    "INSERT INTO public_trades (id, market_id, price, qty, side, ts_ns) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
                )
                .bind(&trade.id)
                .bind(&trade.market_id)
                .bind(&trade.price)
                .bind(&trade.qty)
                .bind(&trade.side)
                .bind(&trade.ts_ns)
                .execute(&self.pool)
                .await?;
            }
            PersistEvent::InsertFunding {
                market_id,
                ts_ns,
                rate_bps,
            } => {
                sqlx::query(
                    "INSERT INTO funding_history (market_id, ts_ns, rate_bps) VALUES ($1,$2,$3) ON CONFLICT (market_id, ts_ns) DO UPDATE SET rate_bps = EXCLUDED.rate_bps",
                )
                .bind(market_id)
                .bind(*ts_ns as i64)
                .bind(*rate_bps)
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }
}

async fn upsert_order(pool: &PgPool, address: &str, order: &OpenOrder) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO open_orders (id, address, market_id, side, order_type, price, qty, remaining, ts_ns, client_order_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET remaining = EXCLUDED.remaining",
    )
    .bind(&order.id)
    .bind(address)
    .bind(&order.market_id)
    .bind(&order.side)
    .bind(&order.order_type)
    .bind(&order.price)
    .bind(&order.qty)
    .bind(&order.remaining)
    .bind(&order.ts_ns)
    .bind(&order.client_order_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Spawn the background writer. Owns a pool clone, drains `rx` until every
/// sender (i.e. `AppState`) is dropped, and applies each event in order. A
/// failed write is logged and skipped — one bad row must not wedge the queue.
pub fn spawn_writer(db: Db, mut rx: tokio::sync::mpsc::UnboundedReceiver<PersistEvent>) {
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            if let Err(e) = db.apply(&ev).await {
                tracing::error!(error = %e, "persist write failed");
            }
        }
        tracing::info!("persistence writer stopped (channel closed)");
    });
}
