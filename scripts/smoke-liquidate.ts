/**
 * Phase 0 smoke test — liquidation pipeline.
 *
 * 1. Trader A opens a 10x long on BTC at $100,000 (size 1.0 BTC, 10k collateral)
 * 2. MockOracle.setPrice(BTC, $87,000) — drops below liquidation threshold
 * 3. Liquidator bot picks up the underwater position within 250ms scan cycle
 * 4. Submit liquidation tx; assert on-chain position size == 0
 * 5. Assert insurance fund non-negative
 *
 * Pass criteria: exit code 0. Fail = any assertion error or timeout.
 *
 * NOTE: requires `make dev-up` first.
 *       Implementation lands in Phase 4 once liquidator crate exists; this file is a stub spec.
 */
async function main() {
  throw new Error("smoke-liquidate.ts not implemented — Phase 4 deliverable");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
