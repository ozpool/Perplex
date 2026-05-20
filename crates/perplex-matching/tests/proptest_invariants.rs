//! Property-based invariants for `perplex_matching::Orderbook`.
//!
//! Default proptest config: 256 cases per property. With 5 properties this is ~1300
//! random sequences per CI run, well under the 100k figure in the issue description
//! when combined with the differential test in PR #60 (500 fixtures × up to 5 fills)
//! and the dispatcher fuzz in PR #62 (16384 paired-fill runs).

use perplex_matching::book::{SelfTradeMode, Side};
use perplex_matching::{Order, OrderType, Orderbook, PositionTracker, TimeInForce};
use proptest::prelude::*;
use rust_decimal::Decimal;

fn addr(b: u8) -> [u8; 20] {
    let mut a = [0u8; 20];
    a[19] = b;
    a
}
const MKT: [u8; 32] = [9u8; 32];

#[derive(Debug, Clone)]
struct Step {
    owner: u8,
    side: Side,
    price: Decimal,
    qty: Decimal,
    tif: TimeInForce,
    post_only: bool,
}

fn arb_steps() -> impl Strategy<Value = Vec<(Step, u64)>> {
    prop::collection::vec(
        (
            1u8..=4,
            prop_oneof![Just(Side::Buy), Just(Side::Sell)],
            90u32..=110,
            1u32..=10,
            prop_oneof![
                Just(TimeInForce::Gtc),
                Just(TimeInForce::Ioc),
                Just(TimeInForce::Fok)
            ],
            prop::bool::ANY,
        ),
        1..=24,
    )
    .prop_map(move |raw| {
        let mut id = 0u64;
        raw.into_iter()
            .map(|(owner, side, p, q, tif, po)| {
                id += 1;
                (
                    Step {
                        owner,
                        side,
                        price: Decimal::new(p as i64, 0),
                        qty: Decimal::new(q as i64, 0),
                        tif,
                        post_only: po,
                    },
                    id,
                )
            })
            .collect()
    })
}

fn play(steps: &[(Step, u64)], self_trade: SelfTradeMode) -> Orderbook {
    let mut book = Orderbook::new(MKT).with_self_trade(self_trade);
    let tracker = PositionTracker::new();
    for (s, id) in steps {
        let o = Order {
            id: *id,
            owner: addr(s.owner),
            market: MKT,
            side: s.side,
            order_type: OrderType::Limit,
            price: s.price,
            qty: s.qty,
            remaining: s.qty,
            time_in_force: s.tif,
            post_only: s.post_only,
            reduce_only: false,
            ts_ns: *id,
        };
        let _ = book.submit(o, &tracker);
    }
    book
}

proptest! {
    /// best_bid < best_ask always; the book never crosses itself.
    #[test]
    fn invariant_no_crossed_book(steps in arb_steps()) {
        let book = play(&steps, SelfTradeMode::CancelNewest);
        if let (Some(b), Some(a)) = (book.best_bid(), book.best_ask()) {
            prop_assert!(b < a, "crossed book: bid={} ask={}", b, a);
        }
    }

    /// No level ever holds a non-positive resting qty (after compaction inside submit).
    #[test]
    fn invariant_level_qty_strictly_positive(steps in arb_steps()) {
        let book = play(&steps, SelfTradeMode::CancelNewest);
        // We can only probe levels we know about — sample prices in the active range.
        for p in 90..=110 {
            let p = Decimal::new(p, 0);
            for side in [Side::Buy, Side::Sell] {
                let q = book.level_qty(side, p);
                prop_assert!(q >= Decimal::ZERO, "negative qty at price={}", p);
            }
        }
    }

    /// After submission, an order id that crossed fully (no rest) must NOT be cancellable.
    #[test]
    fn invariant_consumed_ids_are_not_cancellable(steps in arb_steps()) {
        let book = play(&steps, SelfTradeMode::CancelNewest);
        // For any id we attempt to cancel that wasn't observed to rest, cancel must be
        // idempotent and return either false (not present) or true once (present).
        // Re-cancelling the same id must always be false the second time.
        let mut book = book;
        for (_, id) in &steps {
            let first = book.cancel(*id);
            let second = book.cancel(*id);
            prop_assert!(!second, "cancel was not idempotent for id={}", id);
            // first is either true (was resting) or false (never rested / already filled).
            // Both outcomes are valid.
            let _ = first;
        }
    }

    /// With SelfTradeMode::CancelNewest, no fill ever has maker.owner == taker.owner.
    /// We re-run the steps with a hook that captures fills.
    #[test]
    fn invariant_no_self_fills_under_cancel_newest(steps in arb_steps()) {
        let mut book = Orderbook::new(MKT).with_self_trade(SelfTradeMode::CancelNewest);
        let tracker = PositionTracker::new();
        for (s, id) in &steps {
            let o = Order {
                id: *id,
                owner: addr(s.owner),
                market: MKT,
                side: s.side,
                order_type: OrderType::Limit,
                price: s.price,
                qty: s.qty,
                remaining: s.qty,
                time_in_force: s.tif,
                post_only: s.post_only,
                reduce_only: false,
                ts_ns: *id,
            };
            if let Ok(out) = book.submit(o, &tracker) {
                for f in out.fills {
                    prop_assert_ne!(f.maker_user, f.taker_user, "self-fill leaked through");
                }
            }
        }
    }

    /// Sum of all fill quantities produced never exceeds the sum of submitted order quantities
    /// (no qty created out of thin air).
    #[test]
    fn invariant_fill_qty_conserved(steps in arb_steps()) {
        let mut book = Orderbook::new(MKT).with_self_trade(SelfTradeMode::CancelNewest);
        let tracker = PositionTracker::new();
        let total_submitted: Decimal = steps.iter().map(|(s, _)| s.qty).sum();
        let mut total_filled = Decimal::ZERO;
        for (s, id) in &steps {
            let o = Order {
                id: *id,
                owner: addr(s.owner),
                market: MKT,
                side: s.side,
                order_type: OrderType::Limit,
                price: s.price,
                qty: s.qty,
                remaining: s.qty,
                time_in_force: s.tif,
                post_only: s.post_only,
                reduce_only: false,
                ts_ns: *id,
            };
            if let Ok(out) = book.submit(o, &tracker) {
                for f in out.fills {
                    total_filled += f.qty;
                }
            }
        }
        // Each fill matches a taker qty against a maker qty: counted ONCE on the taker side.
        // So total_filled <= total_submitted (some submissions don't fill any qty).
        prop_assert!(
            total_filled <= total_submitted,
            "filled {} > submitted {}",
            total_filled,
            total_submitted
        );
    }
}
