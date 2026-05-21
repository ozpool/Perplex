import type {
  BalanceResponse,
  Fill,
  FundingResponse,
  Market,
  MarketId,
  OpenOrder,
  OrderbookLevel,
  OrderbookSnapshot,
  PendingTransfer,
  Position,
  PositionsResponse,
  PublicTrade,
} from "@/lib/types/contract";

export const MOCK_WALLET = "0xA0Cf798816D4b9b9866b5330EEa46a18382f251e";

interface MarketState {
  market: Market;
  anchor: number;
  bids: Map<string, string>;
  asks: Map<string, string>;
  sequence: number;
  recentTrades: PublicTrade[];
  funding: { currentRateBps: number; nextSettlementTsNs: bigint; history: { tsNs: string; rateBps: number }[] };
}

function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

function nsStr(b: bigint): string {
  return b.toString();
}

function makeMarket(id: MarketId, base: string, anchor: number, tickSize: string, lotSize: string): MarketState {
  const market: Market = {
    id,
    base,
    quote: "USD",
    active: true,
    tickSize,
    lotSize,
    maxLeverage: 20,
    imRatioBps: 500,
    mmRatioBps: 250,
    liqBonusBps: 100,
    takerFeeBps: 5,
    makerRebateBps: -2,
    fundingIntervalSec: 28800,
    indexPriceX18: anchor.toString(),
  };

  const tick = Number(tickSize);
  const bids = new Map<string, string>();
  const asks = new Map<string, string>();
  for (let i = 1; i <= 60; i++) {
    const px = (anchor - tick * i).toFixed(decFromStep(tickSize));
    const qty = (Math.random() * 2 + 0.05).toFixed(decFromStep(lotSize));
    bids.set(px, qty);
  }
  for (let i = 1; i <= 60; i++) {
    const px = (anchor + tick * i).toFixed(decFromStep(tickSize));
    const qty = (Math.random() * 2 + 0.05).toFixed(decFromStep(lotSize));
    asks.set(px, qty);
  }

  return {
    market,
    anchor,
    bids,
    asks,
    sequence: 1,
    recentTrades: [],
    funding: {
      currentRateBps: (Math.random() - 0.4) * 4,
      nextSettlementTsNs: nowNs() + BigInt(market.fundingIntervalSec) * 1_000_000_000n,
      history: Array.from({ length: 8 }).map((_, idx) => ({
        tsNs: nsStr(nowNs() - BigInt(idx + 1) * BigInt(market.fundingIntervalSec) * 1_000_000_000n),
        rateBps: (Math.random() - 0.5) * 6,
      })),
    },
  };
}

function decFromStep(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

export const STATE = {
  markets: new Map<MarketId, MarketState>([
    ["btc-usd", makeMarket("btc-usd", "BTC", 100_000, "0.1", "0.0001")],
    ["eth-usd", makeMarket("eth-usd", "ETH", 3_500, "0.05", "0.001")],
    ["sol-usd", makeMarket("sol-usd", "SOL", 200, "0.01", "0.01")],
  ]),

  jwt: null as string | null,
  walletAddress: MOCK_WALLET,

  vaultBalanceUsdc: 5_000,
  walletUsdcBalance: 12_500,
  pendingDeposits: [] as PendingTransfer[],
  pendingWithdrawals: [] as PendingTransfer[],

  openOrders: [] as OpenOrder[],
  fills: [] as Fill[],

  positions: [
    {
      marketId: "btc-usd" as MarketId,
      size: "0.1",
      side: "long" as const,
      entryPriceX18: "98500.0",
      markPriceX18: "100050.0",
      notionalUsdc: "10005.0",
      unrealisedPnlUsdc: "155.0",
      realisedPnlUsdc: "0.0",
      leverage: "2.0",
      liquidationPriceX18: "94250.0",
      fundingPaidUsdc: "-1.25",
      lastUpdatedTsNs: nsStr(nowNs()),
    },
  ] as Position[],
};

export function snapshotOf(marketId: MarketId): OrderbookSnapshot {
  const m = STATE.markets.get(marketId);
  if (!m) throw new Error(`unknown market ${marketId}`);
  const bids = Array.from(m.bids.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .slice(0, 50) as OrderbookLevel[];
  const asks = Array.from(m.asks.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 50) as OrderbookLevel[];
  return { marketId, sequence: m.sequence, bids, asks, tsNs: nsStr(nowNs()) };
}

export function mutateBook(marketId: MarketId): {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  sequence: number;
  tsNs: string;
} {
  const m = STATE.markets.get(marketId)!;
  const tick = Number(m.market.tickSize);
  const lotDec = decFromStep(m.market.lotSize);
  const tickDec = decFromStep(m.market.tickSize);

  // Drift the anchor slightly (random walk)
  m.anchor += (Math.random() - 0.5) * tick * 2;

  const deltas: { bids: OrderbookLevel[]; asks: OrderbookLevel[] } = { bids: [], asks: [] };

  for (let i = 0; i < 3; i++) {
    const isBid = Math.random() < 0.5;
    const sideMap = isBid ? m.bids : m.asks;
    const sign = isBid ? -1 : 1;
    const offset = (Math.floor(Math.random() * 60) + 1) * tick * sign;
    const px = (m.anchor + offset).toFixed(tickDec);
    const remove = Math.random() < 0.18;
    if (remove) {
      if (sideMap.has(px)) {
        sideMap.delete(px);
        (isBid ? deltas.bids : deltas.asks).push([px, "0"]);
      }
    } else {
      const qty = (Math.random() * 2 + 0.05).toFixed(lotDec);
      sideMap.set(px, qty);
      (isBid ? deltas.bids : deltas.asks).push([px, qty]);
    }
  }

  m.sequence += 1;
  return { bids: deltas.bids, asks: deltas.asks, sequence: m.sequence, tsNs: nsStr(nowNs()) };
}

export function spawnTrade(marketId: MarketId): PublicTrade {
  const m = STATE.markets.get(marketId)!;
  const tickDec = decFromStep(m.market.tickSize);
  const lotDec = decFromStep(m.market.lotSize);
  const side = Math.random() < 0.5 ? "buy" : "sell";
  const tick = Number(m.market.tickSize);
  const px = (m.anchor + (Math.random() - 0.5) * tick * 4).toFixed(tickDec);
  const qty = (Math.random() * 1.2 + 0.01).toFixed(lotDec);
  const t: PublicTrade = {
    id: `fill_${Math.random().toString(36).slice(2, 10)}`,
    marketId,
    price: px,
    qty,
    side,
    tsNs: nsStr(nowNs()),
  };
  m.recentTrades = [t, ...m.recentTrades].slice(0, 200);
  return t;
}

export function oraclePrice(marketId: MarketId): string {
  const m = STATE.markets.get(marketId)!;
  return m.anchor.toFixed(decFromStep(m.market.tickSize));
}

export function fundingFrame(marketId: MarketId): FundingResponse {
  const m = STATE.markets.get(marketId)!;
  return {
    marketId,
    currentRateBps: m.funding.currentRateBps,
    nextSettlementTsNs: nsStr(m.funding.nextSettlementTsNs),
    history: m.funding.history,
  };
}

export function balanceFrame(): BalanceResponse {
  return {
    vaultBalanceUsdc: STATE.vaultBalanceUsdc.toFixed(2),
    walletUsdcBalance: STATE.walletUsdcBalance.toFixed(2),
    pendingDeposits: STATE.pendingDeposits,
    pendingWithdrawals: STATE.pendingWithdrawals,
  };
}

export function positionsFrame(): PositionsResponse {
  const totalNotional = STATE.positions.reduce((s, p) => s + Number(p.notionalUsdc), 0);
  const totalUnreal = STATE.positions.reduce((s, p) => s + Number(p.unrealisedPnlUsdc), 0);
  const used = totalNotional / Math.max(1, Number(STATE.positions[0]?.leverage ?? 1));
  const free = Math.max(0, STATE.vaultBalanceUsdc - used);
  return {
    collateralUsdc: STATE.vaultBalanceUsdc.toFixed(2),
    freeCollateralUsdc: free.toFixed(2),
    totalUnrealisedPnlUsdc: totalUnreal.toFixed(2),
    totalNotionalUsdc: totalNotional.toFixed(2),
    positions: STATE.positions,
  };
}

export function refreshMarks(): void {
  for (const p of STATE.positions) {
    const newMark = oraclePrice(p.marketId);
    p.markPriceX18 = newMark;
    const entry = Number(p.entryPriceX18);
    const mark = Number(newMark);
    const sz = Number(p.size);
    const dir = p.side === "long" ? 1 : -1;
    const pnl = (mark - entry) * sz * dir;
    p.unrealisedPnlUsdc = pnl.toFixed(2);
    p.notionalUsdc = (mark * sz).toFixed(2);
    p.lastUpdatedTsNs = nsStr(nowNs());
  }
}

export function pushFill(f: Fill): void {
  STATE.fills = [f, ...STATE.fills].slice(0, 500);
}

export function recentPublicTrades(marketId: MarketId, limit: number): PublicTrade[] {
  return STATE.markets.get(marketId)!.recentTrades.slice(0, limit);
}

export { nsStr, nowNs };
