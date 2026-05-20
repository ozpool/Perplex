//! Criterion microbenchmarks for `perplex_matching::Orderbook`.
//!
//! Targets exercised:
//!   - `rest_only`           — submit N limits that never cross
//!   - `rest_and_cross`      — alternate maker/taker, every other order crosses
//!   - `deep_cross`          — taker walks 10 maker levels in one submission
//!
//! Throughput is reported in orders/sec. The Phase 3 acceptance target is
//! ≥100k orders/sec per market on commodity hardware; baseline numbers are
//! captured by `cargo bench -p perplex-matching` and (in CI) the criterion
//! report artifact under `target/criterion/`.
//!
//! Run locally: `make bench` or `cargo bench -p perplex-matching`.

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use perplex_matching::book::Side;
use perplex_matching::{Order, OrderType, Orderbook, PositionTracker, TimeInForce};
use rust_decimal::Decimal;

fn addr(b: u8) -> [u8; 20] {
    let mut a = [0u8; 20];
    a[19] = b;
    a
}
const MKT: [u8; 32] = [7u8; 32];

fn mk_limit(id: u64, owner: u8, side: Side, price: Decimal, qty: Decimal) -> Order {
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
        ts_ns: id,
    }
}

fn bench_rest_only(c: &mut Criterion) {
    let mut group = c.benchmark_group("rest_only");
    group.throughput(Throughput::Elements(1));
    group.bench_function("limit_no_cross", |b| {
        let tracker = PositionTracker::new();
        let mut book = Orderbook::new(MKT);
        // Pre-warm with a few maker layers so the BTreeMap has shape.
        for i in 0..16 {
            let p = Decimal::new(99_000 - i, 0);
            let _ = book.submit(
                mk_limit(i as u64, 1, Side::Buy, p, Decimal::new(1, 0)),
                &tracker,
            );
        }
        let mut next_id: u64 = 1_000_000;
        b.iter(|| {
            next_id += 1;
            // Always sell above the highest bid -> never crosses.
            let o = mk_limit(
                next_id,
                2,
                Side::Sell,
                Decimal::new(101_000, 0),
                Decimal::new(1, 0),
            );
            let out = book.submit(black_box(o), &tracker).unwrap();
            black_box(out);
        });
    });
    group.finish();
}

fn bench_rest_and_cross(c: &mut Criterion) {
    let mut group = c.benchmark_group("rest_and_cross");
    group.throughput(Throughput::Elements(2)); // each iteration runs a maker + taker pair
    group.bench_function("paired_fill_at_top_of_book", |b| {
        let tracker = PositionTracker::new();
        let mut book = Orderbook::new(MKT);
        let mut next_id: u64 = 0;
        b.iter(|| {
            // Maker rests one ask.
            next_id += 1;
            let maker = mk_limit(
                next_id,
                1,
                Side::Sell,
                Decimal::new(100_000, 0),
                Decimal::new(1, 0),
            );
            let _ = book.submit(maker, &tracker).unwrap();
            // Taker buys it immediately.
            next_id += 1;
            let taker = mk_limit(
                next_id,
                2,
                Side::Buy,
                Decimal::new(100_000, 0),
                Decimal::new(1, 0),
            );
            let out = book.submit(black_box(taker), &tracker).unwrap();
            black_box(out);
        });
    });
    group.finish();
}

fn bench_deep_cross(c: &mut Criterion) {
    let mut group = c.benchmark_group("deep_cross");
    group.throughput(Throughput::Elements(10));
    group.bench_function("walk_10_levels", |b| {
        b.iter_batched_ref(
            || {
                let tracker = PositionTracker::new();
                let mut book = Orderbook::new(MKT);
                for i in 0..10 {
                    let p = Decimal::new(100_000 + i, 0);
                    let _ = book.submit(
                        mk_limit(i as u64, 1, Side::Sell, p, Decimal::new(1, 0)),
                        &tracker,
                    );
                }
                (book, tracker)
            },
            |(book, tracker)| {
                // Buy 10 @ 100_010 (crosses all 10 levels at once).
                let taker = mk_limit(
                    1_000,
                    2,
                    Side::Buy,
                    Decimal::new(100_010, 0),
                    Decimal::new(10, 0),
                );
                let out = book.submit(black_box(taker), tracker).unwrap();
                black_box(out);
            },
            criterion::BatchSize::SmallInput,
        );
    });
    group.finish();
}

criterion_group!(
    orderbook,
    bench_rest_only,
    bench_rest_and_cross,
    bench_deep_cross
);
criterion_main!(orderbook);
