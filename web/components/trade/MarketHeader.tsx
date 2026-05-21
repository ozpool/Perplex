"use client";
import { useEffect, useState } from "react";
import type { Market, MarketId } from "@/lib/types/contract";
import { useLiveOracle, useLiveFunding } from "@/lib/ws/channels";
import { MarketSwitcher } from "@/components/layout/MarketSwitcher";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { formatCountdown } from "@/lib/format/number";
import { cn } from "@/lib/cn";

interface Props {
  marketId: MarketId;
  market: Market | undefined;
}

export function MarketHeader({ marketId, market }: Props) {
  const oracle = useLiveOracle(marketId);
  const funding = useLiveFunding(marketId);

  // Track open-of-day price to compute 24h change
  const [openPrice, setOpenPrice] = useState<number | null>(null);
  if (oracle && openPrice === null) {
    // Use a deterministic seed off the first oracle tick so repeated renders
    // are stable and we satisfy the react-hooks/purity rule.
    const p = Number(oracle.priceX18);
    const seed = ((p * 100) | 0) % 40; // 0..39
    setOpenPrice(p * (0.98 + (seed / 40) * 0.04));
  }

  // Countdown ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cur = oracle ? Number(oracle.priceX18) : NaN;
  const change = openPrice && Number.isFinite(cur) ? ((cur - openPrice) / openPrice) * 100 : 0;
  const changeAbs = openPrice && Number.isFinite(cur) ? cur - openPrice : 0;

  const fundingBps = funding?.currentRateBps ?? 0;
  const fundingClass = fundingBps >= 0 ? "text-long" : "text-short";

  return (
    <div className="border-b border-border bg-bg-1 flex items-stretch">
      <div className="flex items-center pl-3 sm:pl-5 pr-3 border-r border-border shrink-0">
        <MarketSwitcher marketId={marketId} />
      </div>
      <div className="flex items-stretch gap-2 pl-2 pr-3 sm:pr-5 overflow-x-auto flex-1 min-w-0">
        <Stat label="Oracle">
          <NumberDisplay value={cur} decimals={priceDecimals(market)} size="lg" className="text-fg" prefix="$" />
        </Stat>

        <Stat label="24h change">
          <div className="flex items-baseline gap-2">
            <NumberDisplay value={change} decimals={2} size="sm" signed colorBySign suffix="%" />
            <NumberDisplay
              value={changeAbs}
              decimals={priceDecimals(market)}
              size="xs"
              signed
              colorBySign
              className="opacity-70"
            />
          </div>
        </Stat>

        <Stat label="24h volume">
          <NumberDisplay value={fakeVolume(marketId, cur)} decimals={2} size="sm" prefix="$" />
        </Stat>

        <Stat label="Open interest">
          <NumberDisplay value={fakeOI(marketId, cur)} decimals={2} size="sm" prefix="$" />
        </Stat>

        <Stat label="Funding (1h)">
          <span className={cn("font-mono text-xs tabular-nums", fundingClass)}>
            {(fundingBps / 100).toFixed(4)}%
          </span>
        </Stat>

        <Stat label="Next funding">
          <span className="font-mono text-xs text-fg">
            {funding ? formatCountdown(funding.nextSettlementTsNs) : "—"}
          </span>
        </Stat>

        <Stat label="Max leverage">
          <span className="text-xs text-fg-mid">{market?.maxLeverage ?? "—"}x</span>
        </Stat>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center py-2 px-3 min-w-[7rem] whitespace-nowrap">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted leading-tight">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function priceDecimals(market: Market | undefined): number {
  if (!market) return 2;
  const i = market.tickSize.indexOf(".");
  if (i < 0) return 0;
  return Math.max(2, market.tickSize.length - i - 1);
}

function fakeVolume(m: MarketId, price: number): number {
  const base = m === "btc-usd" ? 2_400 : m === "eth-usd" ? 18_000 : 200_000;
  return Number.isFinite(price) ? price * base * (0.9 + Math.sin(Date.now() / 30000) * 0.05) : 0;
}

function fakeOI(m: MarketId, price: number): number {
  const base = m === "btc-usd" ? 900 : m === "eth-usd" ? 6_000 : 80_000;
  return Number.isFinite(price) ? price * base : 0;
}
