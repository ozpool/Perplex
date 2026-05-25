/**
 * Trade-tape generator for the replay sim. Two backends:
 *
 *   - `synthetic` (default): deterministic geometric-Brownian-motion ticks seeded by
 *     market name + start timestamp. CI uses this — no network, reproducible, fast.
 *
 *   - `binance`: pulls real 1-minute klines from the public Binance REST API. Off by
 *     default to keep CI hermetic. Enable with `--source binance` for ad-hoc backtests.
 *
 * Each "bar" represents one minute of tape: open/high/low/close. The fill simulator
 * walks the bar's range to decide whether our resting bid/ask was crossed.
 */

export interface Bar {
  tsMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TapeMarketSpec {
  market: string;
  /** Binance symbol used when `source=binance`. */
  binanceSymbol: string;
  /** Starting price for the synthetic walk. Roughly today's spot. */
  startPrice: number;
  /** Annualised vol used for the synthetic walk. */
  annualVol: number;
}

export const DEFAULT_MARKETS: TapeMarketSpec[] = [
  { market: "btc-usd", binanceSymbol: "BTCUSDT", startPrice: 60_000, annualVol: 0.55 },
  { market: "eth-usd", binanceSymbol: "ETHUSDT", startPrice: 3_000, annualVol: 0.70 },
  { market: "sol-usd", binanceSymbol: "SOLUSDT", startPrice: 150, annualVol: 0.90 },
];

const ONE_MIN_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
const MIN_PER_YEAR = 525_600;

export function generateSyntheticTape(
  spec: TapeMarketSpec,
  days: number,
  startMs: number,
): Bar[] {
  const minutes = days * 24 * 60;
  const dt = 1 / MIN_PER_YEAR;
  const sigmaPerMin = spec.annualVol * Math.sqrt(dt);
  // Seed the PRNG with a stable hash of the market name so each market has its own
  // path but the path itself is reproducible from run to run.
  const rng = mulberry32(hashString(`${spec.market}:${startMs}`));

  const bars: Bar[] = new Array(minutes);
  let close = spec.startPrice;
  for (let i = 0; i < minutes; i++) {
    const open = close;
    // Three sub-ticks per bar gives realistic high/low without exploding cost.
    const tick1 = open * Math.exp(sigmaPerMin * gauss(rng) * 0.5);
    const tick2 = tick1 * Math.exp(sigmaPerMin * gauss(rng) * 0.5);
    const tick3 = tick2 * Math.exp(sigmaPerMin * gauss(rng) * 0.5);
    close = tick3;
    const high = Math.max(open, tick1, tick2, tick3);
    const low = Math.min(open, tick1, tick2, tick3);
    bars[i] = { tsMs: startMs + i * ONE_MIN_MS, open, high, low, close };
  }
  return bars;
}

export async function fetchBinanceTape(
  spec: TapeMarketSpec,
  days: number,
  endMs: number,
): Promise<Bar[]> {
  // Binance returns max 1000 klines per request; 30 days * 24 * 60 = 43_200 bars.
  const minutes = days * 24 * 60;
  const PAGE = 1000;
  const bars: Bar[] = [];
  let cursor = endMs - days * ONE_DAY_MS;
  while (bars.length < minutes) {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${spec.binanceSymbol}` +
      `&interval=1m&startTime=${cursor}&limit=${PAGE}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`binance fetch ${spec.binanceSymbol}: ${resp.status}`);
    }
    const rows = (await resp.json()) as unknown[][];
    if (rows.length === 0) break;
    for (const row of rows) {
      bars.push({
        tsMs: row[0] as number,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
      });
    }
    cursor = (rows[rows.length - 1]![0] as number) + ONE_MIN_MS;
  }
  return bars.slice(0, minutes);
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  // Box-Muller. Two uniforms in, one standard normal out.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
