"use client";
import { useEffect, useRef } from "react";
import type { Market, MarketId } from "@/lib/types/contract";
import { useLiveTrades } from "@/lib/ws/channels";
import { formatTimeOfDay } from "@/lib/format/number";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/Skeleton";

interface Props {
  marketId: MarketId;
  market: Market | undefined;
}

export function TradeTape({ marketId, market }: Props) {
  const trades = useLiveTrades(marketId, 40);
  const containerRef = useRef<HTMLDivElement>(null);
  const tickDec = market ? Math.max(2, tickPrecOf(market.tickSize)) : 2;
  const qtyDec = market ? tickPrecOf(market.lotSize) : 4;

  // Flash newest row briefly
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!trades.length) return;
    const first = trades[0];
    if (first.id === lastIdRef.current) return;
    lastIdRef.current = first.id;
    const el = containerRef.current?.querySelector<HTMLDivElement>(`[data-id="${first.id}"]`);
    if (!el) return;
    el.classList.add(first.side === "buy" ? "flash-long" : "flash-short");
  }, [trades]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-9 px-3 border-b border-border flex items-center justify-between text-[11px] text-fg-muted uppercase tracking-wider font-medium">
        <span>Trades</span>
        <span className="text-[10px] normal-case tracking-normal text-fg-muted">last 40</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 h-8 px-3 items-center text-[10px] uppercase tracking-[0.12em] text-fg-muted font-medium border-b border-border bg-bg-1/40 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-left">
          Price
          <span className="inline-flex items-center h-[16px] px-1 rounded-[3px] bg-bg-2 border border-border text-[9px] font-mono uppercase tracking-[0.06em] text-fg-mid leading-none">USD</span>
        </span>
        <span className="inline-flex items-center gap-1.5 justify-end min-w-[5rem]">
          Size
          <span className="inline-flex items-center h-[16px] px-1 rounded-[3px] bg-bg-2 border border-border text-[9px] font-mono uppercase tracking-[0.06em] text-fg-mid leading-none">{market?.base ?? ""}</span>
        </span>
        <span className="inline-flex items-center justify-end min-w-[4rem]">Time</span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-3 space-y-1.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : (
          trades.map((t) => (
            <div
              key={t.id}
              data-id={t.id}
              className="grid grid-cols-[minmax(5.5rem,1fr)_auto_auto] gap-2 h-[26px] px-3 items-center text-[12px] font-mono tabular-nums leading-none text-right shrink-0"
            >
              <span className={cn("text-left whitespace-nowrap", t.side === "buy" ? "text-long" : "text-short")}>
                {Number(t.price).toFixed(tickDec)}
              </span>
              <span className="text-fg-mid min-w-[3.5rem]">{Number(t.qty).toFixed(qtyDec)}</span>
              <span className="text-fg-muted min-w-[4rem]">{formatTimeOfDay(t.tsNs)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function tickPrecOf(s: string): number {
  const i = s.indexOf(".");
  if (i < 0) return 0;
  return s.length - i - 1;
}
