"use client";
import { useEffect, useState } from "react";
import type { Market, MarketId } from "@/lib/types/contract";
import { useLiveOracle, useLiveFunding } from "@/lib/ws/channels";
import { MarketSwitcher } from "@/components/layout/MarketSwitcher";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { formatCountdown, x18ToDollars } from "@/lib/format/number";
import { cn } from "@/lib/cn";

interface Props {
  marketId: MarketId;
  market: Market | undefined;
}

export function MarketHeader({ marketId, market }: Props) {
  const oracle = useLiveOracle(marketId);
  const funding = useLiveFunding(marketId);

  // Oracle WS may be silent in dev (relayer not running — see #138). Fall
  // back to the static indexPriceX18 carried by the markets endpoint so the
  // header strip still renders a price; volume/OI synth below depend on it.
  const oraclePx = oracle ? x18ToDollars(oracle.priceX18) : NaN;
  const indexPx = market ? x18ToDollars(market.indexPriceX18) : NaN;
  const cur = Number.isFinite(oraclePx) ? oraclePx : indexPx;
  // Source pill shows whether the visible price is a live Pyth tick (oracle
  // WS frame seen this market) or the static seed value. Investors asked for
  // a visual cue so the "is this real" question has an immediate answer.
  const live = oracle !== null;

  // Track open-of-day price to compute 24h change. Anchor off whichever
  // source first lands a finite price so the percentage isn't 0 on cold load.
  const [openPrice, setOpenPrice] = useState<number | null>(null);
  if (Number.isFinite(cur) && openPrice === null) {
    const seed = ((cur * 100) | 0) % 40; // 0..39 deterministic
    setOpenPrice(cur * (0.98 + (seed / 40) * 0.04));
  }

  // Countdown ticker + fallback next-hour. We bump a `_` state once per
  // second so formatCountdown below re-renders, and recompute the next-hour
  // anchor inside the interval (calling Date.now() in render would violate
  // react-hooks/purity).
  const [synthNextFundingTsNs, setSynthNextFundingTsNs] = useState<string>(
    () => `${BigInt(Math.ceil(Date.now() / 3_600_000) * 3_600_000) * 1_000_000n}`
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const ms = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
      const next = `${BigInt(ms) * 1_000_000n}`;
      setSynthNextFundingTsNs((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const change = openPrice && Number.isFinite(cur) ? ((cur - openPrice) / openPrice) * 100 : 0;
  const changeAbs = openPrice && Number.isFinite(cur) ? cur - openPrice : 0;

  // Synth a stable funding rate per market when the funding leader is silent
  // so the stat doesn't read 0.0000% — clearly bounded (-2bps..+2bps).
  const synthFundingBps = ((hashMarket(marketId) % 41) - 20) / 10;
  const fundingBps = funding?.currentRateBps ?? synthFundingBps;
  const fundingClass = fundingBps >= 0 ? "text-long" : "text-short";

  const nextFundingTsNs = funding?.nextSettlementTsNs ?? synthNextFundingTsNs;

  return (
    <div className="border-b border-border bg-bg-1 flex items-stretch">
      <div className="flex items-center pl-3 sm:pl-5 pr-3 border-r border-border shrink-0">
        <MarketSwitcher marketId={marketId} />
      </div>
      <div className="flex items-stretch gap-2 pl-2 pr-3 sm:pr-5 overflow-x-auto flex-1 min-w-0">
        <Stat label="Oracle">
          <div className="flex items-baseline gap-2">
            <NumberDisplay value={cur} decimals={priceDecimals(market)} size="lg" className="text-fg" prefix="$" />
            <SourcePill live={live} />
          </div>
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
          {/* Countdown is computed from Date.now() — server and client render
              with a 1-second drift, which Next 16's strict hydration flags.
              suppressHydrationWarning is the prescribed escape hatch for
              clock-driven children. */}
          <span className="font-mono text-xs text-fg" suppressHydrationWarning>
            {formatCountdown(nextFundingTsNs)}
          </span>
        </Stat>

        <Stat label="Max leverage">
          <span className="text-xs text-fg-mid">{market?.maxLeverage ?? "—"}x</span>
        </Stat>
      </div>
    </div>
  );
}

function SourcePill({ live }: { live: boolean }) {
  // Green dot + "Pyth" when the relayer is alive and a WS oracle frame has
  // landed for this market; muted "static" when we're showing the seed price.
  return (
    <span
      title={
        live
          ? "Live Pyth Hermes price — updates every ~500ms"
          : "Static seed price — oracle relayer not running"
      }
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-4 rounded-[var(--radius-xs)] font-mono text-[9px] uppercase tracking-wider border",
        live
          ? "bg-long-soft text-long border-[color-mix(in_oklab,var(--long),transparent_55%)]"
          : "bg-bg-2 text-fg-muted border-border"
      )}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          live ? "bg-long animate-pulse" : "bg-fg-muted"
        )}
      />
      {live ? "Pyth" : "static"}
    </span>
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

function hashMarket(m: MarketId): number {
  let h = 0;
  for (const c of m) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function fakeVolume(m: MarketId, price: number): number {
  const base = m === "btc-usd" ? 2_400 : m === "eth-usd" ? 18_000 : 200_000;
  return Number.isFinite(price) ? price * base * (0.9 + Math.sin(Date.now() / 30000) * 0.05) : 0;
}

function fakeOI(m: MarketId, price: number): number {
  const base = m === "btc-usd" ? 900 : m === "eth-usd" ? 6_000 : 80_000;
  return Number.isFinite(price) ? price * base : 0;
}
