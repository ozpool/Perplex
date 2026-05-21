"use client";
import { useMemo, useState } from "react";
import type { Market, MarketId, OrderbookLevel } from "@/lib/types/contract";
import { useLiveOrderbook } from "@/lib/ws/channels";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/Skeleton";

interface Props {
  marketId: MarketId;
  market: Market | undefined;
  onClickPrice?: (price: string, side: "bid" | "ask") => void;
}

const ROWS = 14;

export function Orderbook({ marketId, market, onClickPrice }: Props) {
  const ob = useLiveOrderbook(marketId);
  const [grouping, setGrouping] = useState<number>(1);
  const [layout, setLayout] = useState<"split" | "bids" | "asks">("split");

  const groupedBids = useMemo(
    () => (ob ? groupLevels(ob.bids, grouping, "bid") : []),
    [ob, grouping]
  );
  const groupedAsks = useMemo(
    () => (ob ? groupLevels(ob.asks, grouping, "ask") : []),
    [ob, grouping]
  );

  const maxBidTotal = totalOf(groupedBids);
  const maxAskTotal = totalOf(groupedAsks);
  const maxTotal = Math.max(maxBidTotal, maxAskTotal, 1);

  const bestBid = ob?.bids[0]?.[0];
  const bestAsk = ob?.asks[0]?.[0];
  const mid = bestBid && bestAsk ? (Number(bestBid) + Number(bestAsk)) / 2 : null;
  const spread = bestBid && bestAsk ? Number(bestAsk) - Number(bestBid) : null;
  const spreadBps = spread && mid ? (spread / mid) * 10000 : null;

  const tickStep = market ? Number(market.tickSize) : 1;
  const tickDec = market ? tickPrecisionOf(market.tickSize) : 2;
  const qtyDec = market ? tickPrecisionOf(market.lotSize) : 4;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-9 px-3 border-b border-border flex items-center justify-between text-[11px]">
        <div className="text-fg-muted uppercase tracking-wider font-medium">Order book</div>
        <div className="flex items-center gap-1">
          <LayoutToggle layout={layout} setLayout={setLayout} />
          <GroupSelect step={tickStep} value={grouping} onChange={setGrouping} dec={tickDec} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 h-8 px-3 items-center text-[10px] uppercase tracking-[0.12em] text-fg-muted font-medium border-b border-border bg-bg-1/40 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-left">
          Price
          <UnitChip>USD</UnitChip>
        </span>
        <span className="inline-flex items-center gap-1.5 justify-end min-w-[5rem]">
          Size
          <UnitChip>{market?.base ?? ""}</UnitChip>
        </span>
        <span className="inline-flex items-center gap-1.5 justify-end min-w-[4.5rem]">
          Total
          <UnitChip>{market?.base ?? ""}</UnitChip>
        </span>
      </div>

      {!ob ? (
        <div className="p-3 space-y-1.5">
          {Array.from({ length: ROWS * 2 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          {(layout === "split" || layout === "asks") && (
            <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col-reverse">
              {groupedAsks.slice(0, ROWS).map(([px, qty, cum]) => (
                <Row
                  key={`a-${px}`}
                  price={px}
                  qty={qty}
                  cum={cum}
                  maxTotal={maxTotal}
                  side="ask"
                  tickDec={tickDec}
                  qtyDec={qtyDec}
                  onClick={() => onClickPrice?.(px, "ask")}
                />
              ))}
            </div>
          )}

          {layout === "split" && (
            <MidSpread mid={mid} spread={spread} spreadBps={spreadBps} dec={tickDec} />
          )}

          {(layout === "split" || layout === "bids") && (
            <div className="flex-1 overflow-y-auto no-scrollbar">
              {groupedBids.slice(0, ROWS).map(([px, qty, cum]) => (
                <Row
                  key={`b-${px}`}
                  price={px}
                  qty={qty}
                  cum={cum}
                  maxTotal={maxTotal}
                  side="bid"
                  tickDec={tickDec}
                  qtyDec={qtyDec}
                  onClick={() => onClickPrice?.(px, "bid")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="h-7 px-3 border-t border-border flex items-center justify-between text-[10px] text-fg-muted font-mono">
        <span>seq {ob?.sequence ?? "—"}</span>
        <span>{ROWS * 2} levels</span>
      </div>
    </div>
  );
}

function Row({
  price,
  qty,
  cum,
  maxTotal,
  side,
  tickDec,
  qtyDec,
  onClick,
}: {
  price: string;
  qty: number;
  cum: number;
  maxTotal: number;
  side: "bid" | "ask";
  tickDec: number;
  qtyDec: number;
  onClick: () => void;
}) {
  const fillPct = Math.min(100, (cum / maxTotal) * 100);
  return (
    <button
      onClick={onClick}
      className="relative grid grid-cols-[minmax(5.5rem,1fr)_auto_auto] gap-2 h-[26px] px-3 items-center text-[12px] font-mono tabular-nums leading-none w-full text-right group hover:bg-bg-2 shrink-0"
    >
      <span
        aria-hidden
        className={cn(
          "absolute right-0 top-0 h-full opacity-50 transition-[width]",
          side === "bid" ? "bg-long-soft" : "bg-short-soft"
        )}
        style={{ width: `${fillPct}%` }}
      />
      <span className={cn("relative z-10 text-left whitespace-nowrap", side === "bid" ? "text-long" : "text-short")}>
        {Number(price).toFixed(tickDec)}
      </span>
      <span className="relative z-10 text-fg-mid min-w-[3.5rem] text-right">{qty.toFixed(qtyDec)}</span>
      <span className="relative z-10 text-fg-muted min-w-[3.5rem] text-right">{cum.toFixed(qtyDec)}</span>
    </button>
  );
}

function MidSpread({
  mid,
  spread,
  spreadBps,
  dec,
}: {
  mid: number | null;
  spread: number | null;
  spreadBps: number | null;
  dec: number;
}) {
  return (
    <div className="border-y border-border h-9 px-3 flex items-center justify-between bg-bg-2/40">
      <div className="text-[11px] text-fg-muted uppercase tracking-wider">Mid</div>
      <div className="font-mono tabular-nums text-sm text-fg">
        {mid !== null ? mid.toFixed(dec) : "—"}
      </div>
      <div className="text-[11px] text-fg-muted">
        spread{" "}
        <span className="font-mono text-fg-mid">
          {spread !== null ? spread.toFixed(dec) : "—"}
        </span>{" "}
        ·{" "}
        <span className="font-mono text-fg-mid">
          {spreadBps !== null ? spreadBps.toFixed(2) : "—"} bps
        </span>
      </div>
    </div>
  );
}

function LayoutToggle({
  layout,
  setLayout,
}: {
  layout: "split" | "bids" | "asks";
  setLayout: (v: "split" | "bids" | "asks") => void;
}) {
  return (
    <div className="flex items-center bg-bg-2 border border-border rounded-[var(--radius-sm)] p-0.5 gap-0.5">
      {(
        [
          { v: "split", label: <SplitIcon /> },
          { v: "bids", label: <BidIcon /> },
          { v: "asks", label: <AskIcon /> },
        ] as const
      ).map((it) => (
        <button
          key={it.v}
          onClick={() => setLayout(it.v)}
          aria-label={`Layout ${it.v}`}
          className={cn(
            "size-5 flex items-center justify-center rounded-[3px]",
            layout === it.v ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg"
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function GroupSelect({
  step,
  value,
  onChange,
  dec,
}: {
  step: number;
  value: number;
  onChange: (v: number) => void;
  dec: number;
}) {
  const opts = [1, 5, 10, 50];
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Group ticks"
      className="bg-bg-2 border border-border rounded-[var(--radius-sm)] text-[11px] text-fg px-1.5 h-5 font-mono"
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {(step * o).toFixed(Math.max(0, dec))}
        </option>
      ))}
    </select>
  );
}

function UnitChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center h-[16px] px-1 rounded-[3px] bg-bg-2 border border-border text-[9px] font-mono uppercase tracking-[0.06em] text-fg-mid leading-none">
      {children}
    </span>
  );
}

function SplitIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="1" width="12" height="2" />
      <rect x="0" y="5" width="9" height="2" />
      <rect x="0" y="9" width="12" height="2" opacity="0.5" />
    </svg>
  );
}
function BidIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="2" width="6" height="2" />
      <rect x="0" y="6" width="10" height="2" />
      <rect x="0" y="10" width="12" height="1.5" />
    </svg>
  );
}
function AskIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <rect x="0" y="0.5" width="12" height="1.5" />
      <rect x="0" y="4" width="10" height="2" />
      <rect x="0" y="8" width="6" height="2" />
    </svg>
  );
}

function tickPrecisionOf(s: string): number {
  const i = s.indexOf(".");
  if (i < 0) return 0;
  return s.length - i - 1;
}

function groupLevels(
  levels: OrderbookLevel[],
  groupMultiplier: number,
  side: "bid" | "ask"
): Array<[string, number, number]> {
  if (levels.length === 0) return [];
  if (groupMultiplier === 1) {
    let cum = 0;
    return levels.map(([px, qty]) => {
      const q = Number(qty);
      cum += q;
      return [px, q, cum];
    });
  }
  // group N adjacent levels (already sorted): keep aggregated sum at top of bucket
  const grouped: Array<[string, number]> = [];
  for (let i = 0; i < levels.length; i += groupMultiplier) {
    const bucket = levels.slice(i, i + groupMultiplier);
    if (!bucket.length) continue;
    const px = side === "bid" ? bucket[0][0] : bucket[0][0];
    const sum = bucket.reduce((s, [, q]) => s + Number(q), 0);
    grouped.push([px, sum]);
  }
  let cum = 0;
  return grouped.map(([px, q]) => {
    cum += q;
    return [px, q, cum];
  });
}

function totalOf(rows: Array<[string, number, number]>): number {
  return rows.length ? rows[rows.length - 1][2] : 0;
}
