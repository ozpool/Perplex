//! Per-market worker dispatcher.
//!
//! On startup the dispatcher spawns one Tokio task per listed market. Each task owns
//! its `Orderbook` exclusively — no locks needed. The dispatcher itself is a thin
//! routing layer: it holds a mapping from `MarketId` to the per-market mpsc sender
//! and forwards commands to the right task.
//!
//! Fills and book deltas produced by every market are pushed to the configured
//! stream writers (typically Redis Streams in production, in-memory in tests).

use std::collections::HashMap;
use std::sync::Arc;

use perplex_core::types::{MarketId, OrderId};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::book::{Orderbook, SelfTradeMode, SubmitOutcome};
use crate::error::SubmitError;
use crate::order::Order;
use crate::position_tracker::PositionTracker;
use crate::stream::{BookDelta, BookDeltaStream, FillStream};

#[derive(Debug)]
pub enum EngineCmd {
    Submit {
        order: Order,
        tracker: Arc<PositionTracker>,
        reply: oneshot::Sender<Result<SubmitOutcome, SubmitError>>,
    },
    Cancel {
        order_id: OrderId,
        reply: oneshot::Sender<bool>,
    },
    /// Best-effort book snapshot. Returns (best_bid, best_ask).
    Top {
        reply: oneshot::Sender<(Option<rust_decimal::Decimal>, Option<rust_decimal::Decimal>)>,
    },
}

pub struct Dispatcher {
    senders: HashMap<MarketId, mpsc::Sender<EngineCmd>>,
    handles: Vec<JoinHandle<()>>,
}

impl Dispatcher {
    /// Spawn one worker per market. `channel_capacity` is the per-market mpsc buffer.
    pub fn start(
        markets: impl IntoIterator<Item = MarketId>,
        channel_capacity: usize,
        fills: Arc<dyn FillStream>,
        deltas: Arc<dyn BookDeltaStream>,
        self_trade: SelfTradeMode,
    ) -> Self {
        let mut senders = HashMap::new();
        let mut handles = Vec::new();

        for m in markets {
            let (tx, rx) = mpsc::channel(channel_capacity);
            let fills = fills.clone();
            let deltas = deltas.clone();
            let handle = tokio::spawn(run_market_worker(m, rx, fills, deltas, self_trade));
            senders.insert(m, tx);
            handles.push(handle);
        }
        Self { senders, handles }
    }

    pub async fn submit(
        &self,
        order: Order,
        tracker: Arc<PositionTracker>,
    ) -> Result<SubmitOutcome, SubmitError> {
        let Some(tx) = self.senders.get(&order.market) else {
            return Err(SubmitError::MarketNoLiquidity);
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        if tx
            .send(EngineCmd::Submit {
                order,
                tracker,
                reply: reply_tx,
            })
            .await
            .is_err()
        {
            return Err(SubmitError::MarketNoLiquidity);
        }
        reply_rx
            .await
            .unwrap_or(Err(SubmitError::MarketNoLiquidity))
    }

    pub async fn cancel(&self, market: &MarketId, order_id: OrderId) -> bool {
        let Some(tx) = self.senders.get(market) else {
            return false;
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        if tx
            .send(EngineCmd::Cancel {
                order_id,
                reply: reply_tx,
            })
            .await
            .is_err()
        {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }

    pub async fn top(
        &self,
        market: &MarketId,
    ) -> Option<(Option<rust_decimal::Decimal>, Option<rust_decimal::Decimal>)> {
        let tx = self.senders.get(market)?;
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(EngineCmd::Top { reply: reply_tx }).await.ok()?;
        reply_rx.await.ok()
    }

    /// Drop the senders so worker tasks exit cleanly, then await them.
    pub async fn shutdown(mut self) {
        self.senders.clear();
        for h in self.handles.drain(..) {
            if let Err(e) = h.await {
                error!(?e, "matching worker join error");
            }
        }
    }
}

async fn run_market_worker(
    market: MarketId,
    mut rx: mpsc::Receiver<EngineCmd>,
    fills: Arc<dyn FillStream>,
    deltas: Arc<dyn BookDeltaStream>,
    self_trade: SelfTradeMode,
) {
    let mut book = Orderbook::new(market).with_self_trade(self_trade);
    let mut sequence: u64 = 0;
    info!(market = ?market, "matching worker started");

    while let Some(cmd) = rx.recv().await {
        match cmd {
            EngineCmd::Submit {
                order,
                tracker,
                reply,
            } => {
                let outcome = book.submit(order.clone(), &tracker);
                if let Ok(out) = &outcome {
                    for f in &out.fills {
                        sequence += 1;
                        if let Err(e) = fills.append_fill(f).await {
                            error!(?e, "fill append failed");
                        }
                        // After each fill, emit a delta entry for the maker level: residual
                        // qty on the level OR a 0 marker if the level is now empty.
                        let level_price = f.price;
                        let level_side = order.side.opposite();
                        let residual = match level_side {
                            crate::book::Side::Buy => qty_at(&book, level_side, level_price),
                            crate::book::Side::Sell => qty_at(&book, level_side, level_price),
                        };
                        let delta = BookDelta {
                            market,
                            sequence,
                            side: level_side,
                            price: level_price,
                            qty: residual,
                            ts_ns: f.ts_ns,
                        };
                        if let Err(e) = deltas.append_delta(&delta).await {
                            error!(?e, "delta append failed");
                        }
                    }
                    // If this order rests, emit a delta for the new resting level.
                    if let Some(_id) = out.resting {
                        sequence += 1;
                        let residual = qty_at(&book, order.side, order.price);
                        let delta = BookDelta {
                            market,
                            sequence,
                            side: order.side,
                            price: order.price,
                            qty: residual,
                            ts_ns: order.ts_ns,
                        };
                        if let Err(e) = deltas.append_delta(&delta).await {
                            error!(?e, "delta append failed");
                        }
                    }
                } else if let Err(e) = &outcome {
                    warn!(?e, "submit rejected");
                }
                let _ = reply.send(outcome);
            }
            EngineCmd::Cancel { order_id, reply } => {
                let _ = reply.send(book.cancel(order_id));
            }
            EngineCmd::Top { reply } => {
                let _ = reply.send((book.best_bid(), book.best_ask()));
            }
        }
    }
    info!(market = ?market, "matching worker shut down");
}

/// Sum of remaining qty resting at `price` on `side`. Used to compute the residual
/// after a fill so the broadcast contains the resulting level state, not just a diff.
fn qty_at(
    book: &Orderbook,
    side: crate::book::Side,
    price: rust_decimal::Decimal,
) -> rust_decimal::Decimal {
    book.level_qty(side, price)
}
