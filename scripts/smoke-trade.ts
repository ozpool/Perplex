/**
 * Phase 0 smoke test — golden path.
 *
 * 1. Connect to local edge REST + WS
 * 2. Trader A posts a limit buy at $99,950 for 0.05 BTC
 * 3. Trader B (or synthetic counterparty) posts a market sell of 0.05 BTC
 * 4. Assert: fill received on WS within 100ms, on-chain position updated within 2s
 *
 * Pass criteria: exit code 0. Fail = any assertion error or timeout.
 *
 * NOTE: requires `make dev-up` first.
 *       Implementation lands in Phase 1 once edge crate exists; this file is a stub spec.
 */
async function main() {
  throw new Error("smoke-trade.ts not implemented — Phase 1 deliverable");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
