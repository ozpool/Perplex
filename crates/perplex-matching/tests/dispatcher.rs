//! Dispatcher routing + MemoryStream fill/delta capture tests.

use std::sync::Arc;

use perplex_matching::book::{SelfTradeMode, Side};
use perplex_matching::{
    Dispatcher, MemoryStream, Order, OrderType, PositionTracker, SubmitError, TimeInForce,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

fn addr(seed: u8) -> [u8; 20] {
    let mut a = [0u8; 20];
    a[19] = seed;
    a
}

fn mid(seed: u8) -> [u8; 32] {
    let mut m = [0u8; 32];
    m[31] = seed;
    m
}

fn limit(id: u64, owner: u8, market: [u8; 32], side: Side, price: Decimal, qty: Decimal) -> Order {
    Order {
        id,
        owner: addr(owner),
        market,
        side,
        order_type: OrderType::Limit,
        price,
        qty,
        remaining: qty,
        time_in_force: TimeInForce::Gtc,
        post_only: false,
        reduce_only: false,
        ts_ns: id,
    }
}

#[tokio::test]
async fn dispatcher_routes_per_market_independently() {
    let stream = Arc::new(MemoryStream::new());
    let btc = mid(1);
    let eth = mid(2);
    let d = Dispatcher::start(
        [btc, eth],
        16,
        stream.clone(),
        stream.clone(),
        SelfTradeMode::default(),
    );
    let t = Arc::new(PositionTracker::new());

    // Rest a maker on each market.
    d.submit(limit(1, 1, btc, Side::Sell, dec!(100), dec!(1)), t.clone())
        .await
        .unwrap();
    d.submit(limit(2, 2, eth, Side::Sell, dec!(3500), dec!(1)), t.clone())
        .await
        .unwrap();

    // Buy on BTC only — ETH should be unaffected.
    let out = d
        .submit(limit(3, 3, btc, Side::Buy, dec!(100), dec!(1)), t.clone())
        .await
        .unwrap();
    assert_eq!(out.fills.len(), 1);
    assert_eq!(out.fills[0].market, btc);

    let (_, btc_ask) = d.top(&btc).await.unwrap();
    let (_, eth_ask) = d.top(&eth).await.unwrap();
    assert!(btc_ask.is_none(), "BTC ask consumed");
    assert_eq!(eth_ask, Some(dec!(3500)), "ETH untouched");

    d.shutdown().await;
}

#[tokio::test]
async fn dispatcher_returns_error_for_unknown_market() {
    let stream = Arc::new(MemoryStream::new());
    let known = mid(1);
    let unknown = mid(99);
    let d = Dispatcher::start(
        [known],
        8,
        stream.clone(),
        stream.clone(),
        SelfTradeMode::default(),
    );
    let t = Arc::new(PositionTracker::new());

    let err = d
        .submit(limit(1, 1, unknown, Side::Buy, dec!(100), dec!(1)), t)
        .await
        .unwrap_err();
    assert_eq!(err, SubmitError::MarketNoLiquidity);
    d.shutdown().await;
}

#[tokio::test]
async fn fills_and_deltas_emitted_to_stream() {
    let stream = Arc::new(MemoryStream::new());
    let m = mid(1);
    let d = Dispatcher::start(
        [m],
        16,
        stream.clone(),
        stream.clone(),
        SelfTradeMode::default(),
    );
    let t = Arc::new(PositionTracker::new());

    // Maker sell 2 @ 100; taker buy 1 @ 100 — emits one fill + one delta showing residual 1.
    d.submit(limit(1, 1, m, Side::Sell, dec!(100), dec!(2)), t.clone())
        .await
        .unwrap();
    // After the resting maker, expect 1 delta with qty=2 (level created).
    let _ = d
        .submit(limit(2, 2, m, Side::Buy, dec!(100), dec!(1)), t.clone())
        .await
        .unwrap();

    // Give the worker a tick to flush async appends.
    tokio::task::yield_now().await;
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let fills = stream.drain_fills();
    let deltas = stream.drain_deltas();

    assert_eq!(fills.len(), 1, "exactly one fill");
    assert_eq!(fills[0].qty, dec!(1));
    assert_eq!(fills[0].price, dec!(100));

    // Deltas: 1 for the original resting maker (qty=2), 1 for after the fill (qty=1).
    assert_eq!(deltas.len(), 2, "rest-delta + fill-delta");
    assert_eq!(deltas[0].qty, dec!(2), "level created at 2");
    assert_eq!(
        deltas[1].qty,
        dec!(1),
        "level residual after taker bought 1"
    );
    d.shutdown().await;
}

#[tokio::test]
async fn cancel_via_dispatcher_returns_true_for_resting_order() {
    let stream = Arc::new(MemoryStream::new());
    let m = mid(1);
    let d = Dispatcher::start(
        [m],
        8,
        stream.clone(),
        stream.clone(),
        SelfTradeMode::default(),
    );
    let t = Arc::new(PositionTracker::new());

    d.submit(limit(1, 1, m, Side::Sell, dec!(100), dec!(1)), t)
        .await
        .unwrap();
    assert!(d.cancel(&m, 1).await);
    assert!(!d.cancel(&m, 1).await, "second cancel is a no-op");
    let (_, ask) = d.top(&m).await.unwrap();
    assert!(ask.is_none());
    d.shutdown().await;
}

#[tokio::test]
async fn concurrent_submits_to_distinct_markets_run_in_parallel() {
    let stream = Arc::new(MemoryStream::new());
    let markets: Vec<[u8; 32]> = (1..=3).map(mid).collect();
    let d = Dispatcher::start(
        markets.clone(),
        32,
        stream.clone(),
        stream.clone(),
        SelfTradeMode::default(),
    );
    let t = Arc::new(PositionTracker::new());

    // Spawn three tasks, each placing a paired fill on its own market.
    let mut handles = Vec::new();
    let d = Arc::new(d);
    for (i, m) in markets.iter().enumerate() {
        let d = d.clone();
        let t = t.clone();
        let m = *m;
        let owner_a = (i * 2 + 1) as u8;
        let owner_b = (i * 2 + 2) as u8;
        handles.push(tokio::spawn(async move {
            d.submit(
                limit(1, owner_a, m, Side::Sell, dec!(100), dec!(1)),
                t.clone(),
            )
            .await
            .unwrap();
            d.submit(
                limit(2, owner_b, m, Side::Buy, dec!(100), dec!(1)),
                t.clone(),
            )
            .await
            .unwrap();
        }));
    }
    for h in handles {
        h.await.unwrap();
    }

    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    let fills = stream.drain_fills();
    assert_eq!(fills.len(), 3, "one fill per market");
    let mut markets_hit: Vec<[u8; 32]> = fills.iter().map(|f| f.market).collect();
    markets_hit.sort();
    let mut want = markets.clone();
    want.sort();
    assert_eq!(markets_hit, want);

    // Cleanly shutdown — drop the only Arc reference via shutdown.
    Arc::try_unwrap(d)
        .ok()
        .expect("no other arc refs")
        .shutdown()
        .await;
}
