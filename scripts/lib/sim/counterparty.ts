/**
 * Counterparty fill simulator. For each minute bar:
 *   1. Compute (bid, ask) from prior-bar mid + current inventory + realised vol.
 *   2. If the bar's low <= bid, we got filled at the bid (bought one quote_size).
 *      If the bar's high >= ask, we got filled at the ask (sold one quote_size).
 *      Both can fire in the same bar — that's how spread capture happens in
 *      mean-reverting flow.
 *   3. Update VolWindow with bar close as the post-bar mid.
 *   4. Track realised PnL via FIFO matching of opposite-side fills. Anything left
 *      open at the end of the tape is marked to the final close.
 *
 * The kill switch (mirroring the live agent) stops quoting a market once realised
 * PnL drops below `-killThresholdUsdc`. Sticky for the rest of the tape — auto-
 * recovery would defeat the purpose.
 */

import { quotes, type StrategyParams } from "./strategy.js";
import type { Bar } from "./tape.js";
import { VolWindow } from "./vol.js";

export interface SimConfig {
  strategy: StrategyParams;
  quoteSize: number;
  volWindowMs: number;
  killThresholdUsdc: number;
}

export interface MarketResult {
  market: string;
  fills: number;
  bidFills: number;
  askFills: number;
  realisedPnl: number;
  finalInventory: number;
  markToMarketPnl: number;
  killed: boolean;
}

interface Lot {
  side: "long" | "short";
  size: number;
  price: number;
}

export function simulateMarket(
  market: string,
  bars: Bar[],
  cfg: SimConfig,
): MarketResult {
  if (bars.length < 2) {
    return {
      market,
      fills: 0,
      bidFills: 0,
      askFills: 0,
      realisedPnl: 0,
      finalInventory: 0,
      markToMarketPnl: 0,
      killed: false,
    };
  }
  const vol = new VolWindow(cfg.volWindowMs);
  const lots: Lot[] = [];
  let inventory = 0;
  let realisedPnl = 0;
  let bidFills = 0;
  let askFills = 0;
  let killed = false;

  // Seed the vol window with the first bar so the second bar has a return.
  vol.record(bars[0]!.tsMs, bars[0]!.close);
  let priorMid = bars[0]!.close;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!;
    if (!killed) {
      const q = quotes(cfg.strategy, priorMid, inventory, vol.realisedVol());

      if (bar.low <= q.bid) {
        const { realised } = applyFill(lots, "long", cfg.quoteSize, q.bid);
        realisedPnl += realised;
        inventory += cfg.quoteSize;
        bidFills += 1;
      }
      if (bar.high >= q.ask) {
        const { realised } = applyFill(lots, "short", cfg.quoteSize, q.ask);
        realisedPnl += realised;
        inventory -= cfg.quoteSize;
        askFills += 1;
      }

      if (realisedPnl < -cfg.killThresholdUsdc) {
        killed = true;
      }
    }

    vol.record(bar.tsMs, bar.close);
    priorMid = bar.close;
  }

  const finalClose = bars[bars.length - 1]!.close;
  const m2m = lots.reduce((acc, lot) => {
    const sign = lot.side === "long" ? 1 : -1;
    return acc + sign * lot.size * (finalClose - lot.price);
  }, 0);

  return {
    market,
    fills: bidFills + askFills,
    bidFills,
    askFills,
    realisedPnl,
    finalInventory: inventory,
    markToMarketPnl: realisedPnl + m2m,
    killed,
  };
}

/**
 * FIFO match the incoming fill against opposite-side lots. Realised PnL accrues on
 * each closed slice; the remainder opens a new same-side lot.
 */
function applyFill(
  lots: Lot[],
  side: "long" | "short",
  size: number,
  price: number,
): { realised: number } {
  let remaining = size;
  let realised = 0;
  while (remaining > 0 && lots.length > 0 && lots[0]!.side !== side) {
    const head = lots[0]!;
    const closed = Math.min(head.size, remaining);
    // long lot closed by short fill -> (sell - buy) * size
    // short lot closed by long fill -> (sell - buy) * size = (entry - exit) * size
    const pnl =
      head.side === "long"
        ? (price - head.price) * closed
        : (head.price - price) * closed;
    realised += pnl;
    head.size -= closed;
    remaining -= closed;
    if (head.size <= 1e-12) lots.shift();
  }
  if (remaining > 0) {
    lots.push({ side, size: remaining, price });
  }
  return { realised };
}
