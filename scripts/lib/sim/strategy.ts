/**
 * TypeScript port of `crates/perplex-cli/src/strategy.rs`. Same formula, intentionally
 * line-by-line so the sim and the live agent stay in sync. If you change strategy.rs,
 * mirror the change here and rerun the replay sim to confirm PnL is still non-negative
 * at default params.
 */

export interface StrategyParams {
  baseSpreadBps: number;
  invPenaltyBpsAtMax: number;
  invMax: number;
  volMultBps: number;
  invSkewBpsAtMax: number;
}

export interface Quotes {
  bid: number;
  ask: number;
  spreadBps: number;
  skewBps: number;
}

export const DEFAULT_STRATEGY: StrategyParams = {
  baseSpreadBps: 10,
  invPenaltyBpsAtMax: 20,
  invMax: 100.0,
  volMultBps: 1000,
  invSkewBpsAtMax: 5,
};

export function quotes(
  p: StrategyParams,
  mid: number,
  inventory: number,
  realisedVol: number,
): Quotes {
  const invRatioSigned =
    p.invMax > 0 ? clamp(inventory / p.invMax, -1, 1) : 0;
  const invPenBps = Math.abs(invRatioSigned) * p.invPenaltyBpsAtMax;
  const volPenBps = Math.max(realisedVol, 0) * p.volMultBps;
  const spreadBps = p.baseSpreadBps + invPenBps + volPenBps;

  const skewBps = -invRatioSigned * p.invSkewBpsAtMax;
  const skewedMid = mid * (1 + skewBps / 10_000);

  const halfSpread = spreadBps / 2 / 10_000;
  return {
    bid: skewedMid * (1 - halfSpread),
    ask: skewedMid * (1 + halfSpread),
    spreadBps,
    skewBps,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
