/**
 * Phase 7 acceptance harness for issue #46 — replay 30 days of trade tape through the
 * synthetic-counterparty strategy and assert net PnL across BTC/ETH/SOL is non-negative
 * at default parameters.
 *
 * Default tape source is deterministic synthetic ticks so CI is hermetic and
 * reproducible. Pass `--source binance` to fetch real 1-minute klines from the public
 * Binance REST API instead (no auth required, but flaky in CI — operator-only).
 *
 * Exit 0  net PnL >= 0
 * Exit 1  net PnL < 0  (prints per-market loss attribution before exiting)
 *
 * Usage:
 *   pnpm tsx scripts/replay-binance.ts [--source synthetic|binance] [--days 30]
 *     [--quote-size 0.05] [--kill-usdc 500] [--start-ms 1717200000000]
 */

import {
  DEFAULT_MARKETS,
  fetchBinanceTape,
  generateSyntheticTape,
  type Bar,
  type TapeMarketSpec,
} from "./lib/sim/tape.js";
import { simulateMarket, type MarketResult, type SimConfig } from "./lib/sim/counterparty.js";
import { DEFAULT_STRATEGY } from "./lib/sim/strategy.js";

interface CliArgs {
  source: "synthetic" | "binance";
  days: number;
  quoteSize: number;
  killUsdc: number;
  startMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    source: "synthetic",
    days: 30,
    quoteSize: 0.05,
    killUsdc: 500,
    // Fixed default start so the synthetic tape is reproducible across runs.
    // 2026-04-25 00:00:00 UTC.
    startMs: 1745539200000,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--source":
        out.source = argv[++i] as CliArgs["source"];
        if (out.source !== "synthetic" && out.source !== "binance") {
          throw new Error(`--source must be synthetic|binance (got ${out.source})`);
        }
        break;
      case "--days":
        out.days = Number(argv[++i]);
        break;
      case "--quote-size":
        out.quoteSize = Number(argv[++i]);
        break;
      case "--kill-usdc":
        out.killUsdc = Number(argv[++i]);
        break;
      case "--start-ms":
        out.startMs = Number(argv[++i]);
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return out;
}

async function loadTape(spec: TapeMarketSpec, args: CliArgs): Promise<Bar[]> {
  if (args.source === "binance") {
    return await fetchBinanceTape(spec, args.days, Date.now());
  }
  return generateSyntheticTape(spec, args.days, args.startMs);
}

function fmt(n: number, digits = 2): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg: SimConfig = {
    strategy: DEFAULT_STRATEGY,
    quoteSize: args.quoteSize,
    // 15 minutes; matches the PRD-default --vol-window-secs.
    volWindowMs: 15 * 60 * 1000,
    killThresholdUsdc: args.killUsdc,
  };

  console.log(
    `replay-sim source=${args.source} days=${args.days} quote_size=${args.quoteSize} ` +
      `kill_usdc=${args.killUsdc}`,
  );

  const results: MarketResult[] = [];
  for (const spec of DEFAULT_MARKETS) {
    const bars = await loadTape(spec, args);
    const r = simulateMarket(spec.market, bars, cfg);
    results.push(r);
    console.log(
      `  ${spec.market.padEnd(8)} fills=${r.fills.toString().padStart(5)} ` +
        `bid=${r.bidFills.toString().padStart(5)} ask=${r.askFills.toString().padStart(5)} ` +
        `realised=${fmt(r.realisedPnl)} inv=${fmt(r.finalInventory, 4)} ` +
        `m2m=${fmt(r.markToMarketPnl)}${r.killed ? " KILLED" : ""}`,
    );
  }

  const netPnl = results.reduce((a, r) => a + r.markToMarketPnl, 0);
  console.log(`net counterparty PnL = ${fmt(netPnl)} USDC`);

  if (netPnl < 0) {
    console.error("\nFAIL: net counterparty PnL is negative at default params.");
    console.error("Loss attribution:");
    for (const r of results) {
      if (r.markToMarketPnl < 0) {
        console.error(`  ${r.market}: ${fmt(r.markToMarketPnl)} USDC`);
      }
    }
    process.exit(1);
  }
  console.log("PASS: net counterparty PnL >= 0 at default params.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
