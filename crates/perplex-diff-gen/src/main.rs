//! Fixture generator for the Foundry differential test.
//!
//! Produces a JSON manifest of random VWAP scenarios with the expected Rust outputs.
//! The Solidity differential test then replays each scenario through PositionRegistry
//! and asserts bit-for-bit agreement on (final_size, final_entry, realised PnLs).
//!
//! Usage (from repo root):
//!   cargo run -p perplex-diff-gen --release --bin gen-vwap-fixtures > \
//!     contracts/test/differential/fixtures.json
//!
//! The fixture is committed to the repo so the differential test is hermetic; regenerate
//! after any change to perplex_core::margin.

use perplex_core::margin::apply_fill;
use perplex_core::types::Position;
use rand::{Rng, SeedableRng};
use rand_xoshiro::Xoshiro256PlusPlus;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Serialize;
use std::io::Write;

/// Number of scenarios. Bumping to 1000 is feasible (~30s Solidity replay); we
/// pick 500 as a balance between coverage and CI wall-clock.
const SCENARIOS: usize = 500;
const SEED: u64 = 0xC0FFEE_F00D_BEEFu64;

#[derive(Serialize)]
struct Fixture {
    seed: u64,
    #[serde(rename = "scenarioCount")]
    scenario_count: usize,
    scenarios: Vec<Scenario>,
}

#[derive(Serialize)]
struct Scenario {
    #[serde(rename = "initialSizeX18")]
    initial_size: String,
    #[serde(rename = "initialEntryX18")]
    initial_entry: String,
    #[serde(rename = "fillCount")]
    fill_count: usize,
    fills: Vec<Fill>,
    expected: Expected,
}

#[derive(Serialize)]
struct Fill {
    #[serde(rename = "sizeDeltaX18")]
    size_delta: String,
    #[serde(rename = "priceX18")]
    price: String,
}

#[derive(Serialize)]
struct Expected {
    #[serde(rename = "finalSizeX18")]
    final_size: String,
    #[serde(rename = "finalEntryX18")]
    final_entry: String,
    #[serde(rename = "realisedX18")]
    realised: Vec<String>,
}

fn pos(size: Decimal, entry: Decimal) -> Position {
    Position {
        user: [0; 20],
        market: [0; 32],
        size,
        entry_price: entry,
        cumulative_funding: Decimal::ZERO,
        last_updated_ts_ns: 0,
    }
}

fn rand_size(rng: &mut Xoshiro256PlusPlus) -> Decimal {
    // magnitude 0.001 .. 10 (1e3 .. 1e7 scaled-by-1000)
    let mag = rng.gen_range(1i64..=10_000);
    let sign = if rng.gen_bool(0.5) { 1 } else { -1 };
    Decimal::new(sign * mag, 3)
}

fn rand_price(rng: &mut Xoshiro256PlusPlus) -> Decimal {
    // 50 .. 200_000 with 3 decimals
    let n = rng.gen_range(50_000i64..=200_000_000);
    Decimal::new(n, 3)
}

/// Format a Decimal as a 1e18-scaled integer string for Solidity consumption.
fn to_x18(d: Decimal) -> String {
    let scaled = d * dec!(1_000_000_000_000_000_000);
    let trunc = scaled.trunc();
    let i = trunc.mantissa();
    if trunc.scale() != 0 {
        // After trunc() the scale should be 0; if not, fall back to string formatting.
        return trunc.to_string();
    }
    i.to_string()
}

fn main() {
    let mut rng = Xoshiro256PlusPlus::seed_from_u64(SEED);
    let mut scenarios = Vec::with_capacity(SCENARIOS);

    for _ in 0..SCENARIOS {
        // Initial position: 80% chance of starting flat, 20% with random open size.
        let (init_size, init_entry) = if rng.gen_bool(0.2) {
            (rand_size(&mut rng), rand_price(&mut rng))
        } else {
            (Decimal::ZERO, Decimal::ZERO)
        };

        let mut p = pos(init_size, init_entry);
        let n_fills = rng.gen_range(1..=5);
        let mut fills_out = Vec::with_capacity(n_fills);
        let mut realised_out = Vec::with_capacity(n_fills);

        for _ in 0..n_fills {
            let delta = rand_size(&mut rng);
            // skip zero or fully-cancelling deltas — apply_fill expects nonzero
            if delta.is_zero() {
                continue;
            }
            let price = rand_price(&mut rng);
            let r = apply_fill(&mut p, delta, price);
            fills_out.push(Fill {
                size_delta: to_x18(delta),
                price: to_x18(price),
            });
            realised_out.push(to_x18(r));
        }

        let fill_count = fills_out.len();
        scenarios.push(Scenario {
            initial_size: to_x18(init_size),
            initial_entry: to_x18(init_entry),
            fill_count,
            fills: fills_out,
            expected: Expected {
                final_size: to_x18(p.size),
                final_entry: to_x18(p.entry_price),
                realised: realised_out,
            },
        });
    }

    let scenario_count = scenarios.len();
    let fixture = Fixture {
        seed: SEED,
        scenario_count,
        scenarios,
    };
    let json = serde_json::to_string_pretty(&fixture).expect("serialize");
    std::io::stdout()
        .write_all(json.as_bytes())
        .and_then(|_| writeln!(std::io::stdout()))
        .expect("write");
}
