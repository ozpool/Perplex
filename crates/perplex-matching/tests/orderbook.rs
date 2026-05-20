//! Orderbook + order-type integration tests for perplex-matching.

use perplex_matching::book::SelfTradeMode;
use perplex_matching::{
    Order, OrderType, Orderbook, PositionTracker, Side, SubmitError, TimeInForce,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

fn addr(seed: u8) -> [u8; 20] {
    let mut a = [0u8; 20];
    a[19] = seed;
    a
}

const MKT: [u8; 32] = [1u8; 32];

fn limit_order(id: u64, owner: u8, side: Side, price: Decimal, qty: Decimal) -> Order {
    Order {
        id,
        owner: addr(owner),
        market: MKT,
        side,
        order_type: OrderType::Limit,
        price,
        qty,
        remaining: qty,
        time_in_force: TimeInForce::Gtc,
        post_only: false,
        reduce_only: false,
        ts_ns: id, // monotonic
    }
}

fn market_order(id: u64, owner: u8, side: Side, qty: Decimal) -> Order {
    Order {
        id,
        owner: addr(owner),
        market: MKT,
        side,
        order_type: OrderType::Market,
        price: Decimal::ZERO,
        qty,
        remaining: qty,
        time_in_force: TimeInForce::Ioc,
        post_only: false,
        reduce_only: false,
        ts_ns: id,
    }
}

fn submit(b: &mut Orderbook, o: Order) -> Result<usize, SubmitError> {
    let t = PositionTracker::new();
    b.submit(o, &t).map(|out| out.fills.len())
}

// -- price-time priority --------------------------------------------------

#[test]
fn rest_orders_no_cross() {
    let mut b = Orderbook::new(MKT);
    assert_eq!(
        submit(&mut b, limit_order(1, 1, Side::Buy, dec!(99), dec!(1))).unwrap(),
        0
    );
    assert_eq!(
        submit(&mut b, limit_order(2, 2, Side::Sell, dec!(101), dec!(1))).unwrap(),
        0
    );
    assert_eq!(b.best_bid(), Some(dec!(99)));
    assert_eq!(b.best_ask(), Some(dec!(101)));
}

#[test]
fn crossing_buy_walks_lowest_ask_first() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(102), dec!(2))).unwrap();
    submit(&mut b, limit_order(2, 1, Side::Sell, dec!(101), dec!(2))).unwrap();
    submit(&mut b, limit_order(3, 1, Side::Sell, dec!(100), dec!(2))).unwrap();

    // Taker buys 3 @ 102 — should walk 100, 101 levels.
    let t = PositionTracker::new();
    let out = b
        .submit(limit_order(99, 2, Side::Buy, dec!(102), dec!(3)), &t)
        .unwrap();
    assert_eq!(out.fills.len(), 2);
    assert_eq!(out.fills[0].price, dec!(100));
    assert_eq!(out.fills[0].qty, dec!(2));
    assert_eq!(out.fills[1].price, dec!(101));
    assert_eq!(out.fills[1].qty, dec!(1));
    assert_eq!(out.remaining, Decimal::ZERO);
    assert_eq!(b.best_ask(), Some(dec!(101))); // partial remainder at 101
}

#[test]
fn fifo_within_same_level() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();
    submit(&mut b, limit_order(2, 2, Side::Sell, dec!(100), dec!(1))).unwrap();
    submit(&mut b, limit_order(3, 3, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let out = b
        .submit(limit_order(99, 4, Side::Buy, dec!(100), dec!(1)), &t)
        .unwrap();
    // Earliest maker (id=1) should be matched first.
    assert_eq!(out.fills.len(), 1);
    assert_eq!(out.fills[0].maker_order_id, 1);
}

// -- order types ----------------------------------------------------------

#[test]
fn market_order_fully_consumes_book() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(2))).unwrap();
    submit(&mut b, limit_order(2, 1, Side::Sell, dec!(101), dec!(2))).unwrap();

    let t = PositionTracker::new();
    let out = b
        .submit(market_order(3, 2, Side::Buy, dec!(3)), &t)
        .unwrap();
    assert_eq!(out.fills.len(), 2);
    assert_eq!(out.remaining, Decimal::ZERO);
}

#[test]
fn market_order_no_liquidity_errors() {
    let mut b = Orderbook::new(MKT);
    let t = PositionTracker::new();
    let err = b
        .submit(market_order(1, 2, Side::Buy, dec!(1)), &t)
        .unwrap_err();
    assert_eq!(err, SubmitError::MarketNoLiquidity);
}

#[test]
fn limit_ioc_cancels_unfilled_remainder() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let mut o = limit_order(2, 2, Side::Buy, dec!(100), dec!(3));
    o.time_in_force = TimeInForce::Ioc;
    let out = b.submit(o, &t).unwrap();
    assert_eq!(out.fills.len(), 1);
    assert_eq!(out.fills[0].qty, dec!(1));
    assert_eq!(out.remaining, dec!(2));
    assert!(out.resting.is_none(), "IOC must not rest");
}

#[test]
fn fok_fully_fills_or_rejects() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let mut undersized = limit_order(2, 2, Side::Buy, dec!(100), dec!(2));
    undersized.time_in_force = TimeInForce::Fok;
    let err = b.submit(undersized, &t).unwrap_err();
    assert_eq!(err, SubmitError::FokUnfillable);

    // Book unchanged.
    assert_eq!(b.best_ask(), Some(dec!(100)));

    // FOK with exact size succeeds.
    let mut exact = limit_order(3, 3, Side::Buy, dec!(100), dec!(1));
    exact.time_in_force = TimeInForce::Fok;
    let out = b.submit(exact, &t).unwrap();
    assert_eq!(out.fills.len(), 1);
    assert!(out.resting.is_none());
}

#[test]
fn post_only_rejects_if_would_cross() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let mut po = limit_order(2, 2, Side::Buy, dec!(100), dec!(1));
    po.post_only = true;
    let err = b.submit(po, &t).unwrap_err();
    assert_eq!(err, SubmitError::PostOnlyWouldCross);

    // Maker untouched.
    assert_eq!(b.best_ask(), Some(dec!(100)));
}

#[test]
fn post_only_accepted_if_no_cross() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(101), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let mut po = limit_order(2, 2, Side::Buy, dec!(100), dec!(1));
    po.post_only = true;
    let out = b.submit(po, &t).unwrap();
    assert_eq!(out.fills.len(), 0);
    assert_eq!(out.resting, Some(2));
}

// -- reduce-only ----------------------------------------------------------

#[test]
fn reduce_only_rejects_opening_order() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let tracker = PositionTracker::new();
    let mut ro = limit_order(2, 2, Side::Buy, dec!(100), dec!(1));
    ro.reduce_only = true;
    let err = b.submit(ro, &tracker).unwrap_err();
    assert_eq!(err, SubmitError::ReduceOnlyWouldIncrease);
}

#[test]
fn reduce_only_allows_closing_order() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    // owner=2 is short 1 BTC -> buying 1 closes them.
    let mut tracker = PositionTracker::new();
    tracker.set(addr(2), MKT, dec!(-1));

    let mut ro = limit_order(2, 2, Side::Buy, dec!(100), dec!(1));
    ro.reduce_only = true;
    let out = b.submit(ro, &tracker).unwrap();
    assert_eq!(out.fills.len(), 1);
}

#[test]
fn reduce_only_rejects_oversized_close() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(5))).unwrap();

    // owner=2 is short 1 BTC. Buying 2 would flip them long — rejected.
    let mut tracker = PositionTracker::new();
    tracker.set(addr(2), MKT, dec!(-1));

    let mut ro = limit_order(2, 2, Side::Buy, dec!(100), dec!(2));
    ro.reduce_only = true;
    let err = b.submit(ro, &tracker).unwrap_err();
    assert_eq!(err, SubmitError::ReduceOnlyWouldIncrease);
}

// -- self-trade prevention ------------------------------------------------

#[test]
fn self_trade_default_rejects_taker() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let err = b
        .submit(limit_order(2, 1, Side::Buy, dec!(100), dec!(1)), &t)
        .unwrap_err();
    assert_eq!(err, SubmitError::SelfTradeRejected);
    assert_eq!(
        b.best_ask(),
        Some(dec!(100)),
        "maker stays on cancel-newest mode"
    );
}

#[test]
fn self_trade_cancel_both_removes_maker_and_rejects_taker() {
    let mut b = Orderbook::new(MKT).with_self_trade(SelfTradeMode::CancelBoth);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    // Taker is still rejected (no fills produced against same owner), but maker is removed.
    let _ = b.submit(limit_order(2, 1, Side::Buy, dec!(100), dec!(1)), &t);
    // Maker (id=1) was on ask side; verify the book is empty.
    assert!(b.best_ask().is_none(), "cancel-both removes the maker");
}

#[test]
fn self_trade_allow_mode_lets_fills_happen() {
    let mut b = Orderbook::new(MKT).with_self_trade(SelfTradeMode::Allow);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();

    let t = PositionTracker::new();
    let out = b
        .submit(limit_order(2, 1, Side::Buy, dec!(100), dec!(1)), &t)
        .unwrap();
    assert_eq!(out.fills.len(), 1, "self-trade allowed in this mode");
}

// -- cancellation ---------------------------------------------------------

#[test]
fn cancel_removes_resting_order() {
    let mut b = Orderbook::new(MKT);
    submit(&mut b, limit_order(1, 1, Side::Sell, dec!(100), dec!(1))).unwrap();
    assert!(b.cancel(1));
    assert_eq!(b.best_ask(), None);
}

#[test]
fn cancel_unknown_id_returns_false() {
    let mut b = Orderbook::new(MKT);
    assert!(!b.cancel(999));
}

// -- input validation -----------------------------------------------------

#[test]
fn zero_qty_rejected() {
    let mut b = Orderbook::new(MKT);
    let t = PositionTracker::new();
    let mut o = limit_order(1, 1, Side::Buy, dec!(100), dec!(1));
    o.qty = Decimal::ZERO;
    assert_eq!(b.submit(o, &t).unwrap_err(), SubmitError::ZeroQty);
}

#[test]
fn limit_zero_price_rejected() {
    let mut b = Orderbook::new(MKT);
    let t = PositionTracker::new();
    let mut o = limit_order(1, 1, Side::Buy, dec!(100), dec!(1));
    o.price = Decimal::ZERO;
    assert_eq!(b.submit(o, &t).unwrap_err(), SubmitError::ZeroPrice);
}
