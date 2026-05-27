"use client";
import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useMarkets } from "@/lib/api/queries";
import { API_BASE } from "@/lib/api/rest";
import { useLiveOracle, useLiveFunding } from "@/lib/ws/channels";
import { useUi } from "@/lib/store/ui-store";
import { CoinIcon } from "@/components/markets/CoinIcon";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import type { Market, MarketId } from "@/lib/types/contract";
import { cn } from "@/lib/cn";

type SortKey = "volume" | "change" | "name";

export default function MarketsPage() {
  const { data, isLoading, isError, error, refetch } = useMarkets();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");

  const markets = useMemo(() => {
    const list = data?.markets ?? [];
    const filtered = query
      ? list.filter((m) => m.base.toLowerCase().includes(query.toLowerCase()))
      : list;
    const sorted = [...filtered];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.base.localeCompare(b.base));
    } else if (sortBy === "volume") {
      sorted.sort((a, b) => pseudoVolume(b) - pseudoVolume(a));
    } else if (sortBy === "change") {
      sorted.sort((a, b) => pseudoChange(b) - pseudoChange(a));
    }
    return sorted;
  }, [data, query, sortBy]);

  return (
    <div className="relative px-3 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-screen-xl w-full mx-auto flex flex-col gap-8">
      {/* Bg flair */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] -z-10"
        style={{
          background:
            "radial-gradient(circle at 15% 0%, rgba(255,107,26,0.10) 0%, transparent 55%), radial-gradient(circle at 85% 10%, rgba(98,126,234,0.10) 0%, transparent 55%)",
        }}
      />

      {/* Header */}
      <div className="max-w-[60ch]">
        <span className="inline-flex items-center gap-2 px-3 h-7 rounded-full bg-bg-1 border border-border-strong text-[11px] font-mono uppercase tracking-[0.18em] text-accent">
          <span className="size-1.5 rounded-full bg-accent pulse-dot" />
          {process.env.NEXT_PUBLIC_NETWORK_LABEL ?? "Local · dev"}
        </span>
        <h1 className="font-display text-[clamp(34px,4.4vw,56px)] font-semibold tracking-[-0.025em] text-fg mt-4 leading-[1.02]">
          Pick a market <span className="text-accent">to trade.</span>
        </h1>
        <p className="text-sm sm:text-[15px] text-fg-mid mt-3 leading-relaxed">
          Three perps. Cross-margin USDC collateral. Funding settles every 8h.
          Tap a card to open the trade view.
        </p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatBlock label="Trading volume" badge="24h" value="$48.2M" tone="accent" />
        <StatBlock label="Open interest" badge="current" value="$12.7M" tone="long" />
        <StatBlock label="Fees generated" badge="24h" value="$3,279.51" tone="muted" />
      </div>

      {/* Featured cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {markets.slice(0, 3).map((m) => (
          <FeaturedCard key={m.id} market={m} />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-[360px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets…"
            className="w-full h-10 pl-9 pr-3 rounded-[var(--radius-md)] bg-bg-1 border border-border text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-border-strong"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-full bg-bg-1 border border-border">
          {(["volume", "change", "name"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSortBy(k)}
              className={cn(
                "px-3 h-7 rounded-full text-[11px] font-medium uppercase tracking-[0.1em] transition-colors",
                sortBy === k ? "bg-accent-soft text-accent" : "text-fg-mid hover:text-fg"
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <CategoryTabs />

      {/* Table */}
      <Card raised className="overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_repeat(5,1fr)_auto] gap-3 px-5 h-11 border-b border-border text-[10px] uppercase tracking-[0.14em] text-fg-muted font-medium items-center">
          <span>Market</span>
          <span className="text-right">Mark price</span>
          <span className="text-right">24h change</span>
          <span className="text-right">24h volume</span>
          <span className="text-right">Funding (1h)</span>
          <span className="text-right">Max leverage</span>
          <span className="w-20" />
        </div>

        {isError && (
          <div className="p-6">
            <ErrorState
              title="Failed to load markets"
              description={`${error instanceof Error ? error.message : String(error ?? "unknown error")} — GET ${API_BASE}/v1/markets. Is perplex-edge running and reachable from the browser?`}
              onRetry={() => refetch()}
            />
          </div>
        )}
        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {markets.map((m) => (
          <MarketRow key={m.id} market={m} />
        ))}

        {!isLoading && markets.length === 0 && (
          <div className="p-10 text-center text-sm text-fg-mid">No markets match "{query}".</div>
        )}
      </Card>
    </div>
  );
}

/* ── Featured card ──────────────────────────────────────────────────────── */
function FeaturedCard({ market }: { market: Market }) {
  const oracle = useLiveOracle(market.id);
  const funding = useLiveFunding(market.id);
  const setMarket = useUi((s) => s.setSelectedMarket);

  const price = oracle ? Number(oracle.priceX18) : null;
  const change = pseudoChange(market);
  const fundingPct = funding ? funding.currentRateBps / 100 : null;

  const sparkline = useSparkline(price ?? 100, market.id);

  const positive = change >= 0;

  return (
    <Link
      href={`/trade/${market.id}`}
      onClick={() => setMarket(market.id)}
      className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-1 hover:border-border-strong hover:-translate-y-0.5 transition-all duration-200 p-5 flex flex-col gap-4 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div
        aria-hidden
        className="absolute -top-16 -right-16 size-52 rounded-full opacity-25 group-hover:opacity-45 transition-opacity blur-3xl pointer-events-none"
        style={{ background: BASE_GLOW[market.id as MarketId] || "var(--accent)" }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${BASE_LINE[market.id as MarketId] || "var(--accent)"}, transparent)`,
        }}
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CoinIcon marketId={market.id as MarketId} size={44} />
          <div className="leading-tight">
            <div className="text-[16px] font-semibold text-fg">{market.base}-PERP</div>
            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-fg-muted mt-0.5">
              {market.base}/USDC
            </div>
          </div>
        </div>
        <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-bg-2 border border-border text-[10px] font-mono uppercase tracking-[0.12em] text-fg-mid">
          up to {market.maxLeverage}×
        </span>
      </div>

      <div className="relative">
        <div className="font-mono text-[32px] font-semibold tabular-nums text-fg leading-none">
          {price === null ? "—" : `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
        </div>
        <div className={cn("text-[12px] font-mono mt-2 tabular-nums inline-flex items-center gap-1.5", positive ? "text-long" : "text-short")}>
          <span className={cn("inline-block size-0 border-x-[5px] border-x-transparent", positive ? "border-b-[7px] border-b-long" : "border-t-[7px] border-t-short")} />
          {positive ? "+" : ""}
          {change.toFixed(2)}%
          <span className="text-fg-muted">· 24h</span>
        </div>
      </div>

      <div className="relative">
        <Sparkline points={sparkline} color={positive ? "var(--long)" : "var(--short)"} />
      </div>

      <div className="relative flex items-center justify-between text-[11px] text-fg-mid mt-auto pt-1 border-t border-border">
        <span className="font-mono">
          Funding{" "}
          <span className={cn("font-medium", (fundingPct ?? 0) >= 0 ? "text-long" : "text-short")}>
            {fundingPct !== null ? `${fundingPct.toFixed(4)}%` : "—"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-accent group-hover:gap-1.5 transition-all font-medium">
          Open market
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

/* ── Stat block ─────────────────────────────────────────────────────────── */
function StatBlock({ label, badge, value, tone }: { label: string; badge: string; value: string; tone: "accent" | "long" | "muted" }) {
  const valueColor = tone === "accent" ? "text-accent" : tone === "long" ? "text-long" : "text-fg";
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-bg-1 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-fg-muted font-mono">{label}</span>
        <span className="inline-flex items-center h-4 px-1.5 rounded-[4px] bg-bg-2 text-[9px] font-mono uppercase tracking-[0.1em] text-fg-mid">
          {badge}
        </span>
      </div>
      <div className={cn("font-mono text-[22px] font-semibold tabular-nums", valueColor)}>{value}</div>
    </div>
  );
}

/* ── Category tabs ──────────────────────────────────────────────────────── */
function CategoryTabs() {
  type Cat = { label: string; active?: boolean; badge?: string; soon?: boolean };
  const CATS: Cat[] = [
    { label: "All", active: true, badge: "3" },
    { label: "Crypto", badge: "3" },
    { label: "Layer 1", badge: "2" },
    { label: "Layer 2", badge: "1" },
    { label: "Forex", soon: true },
    { label: "RWA", soon: true },
    { label: "Gaming", soon: true },
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 no-scrollbar">
      {CATS.map((c) => (
        <button
          key={c.label}
          disabled={c.soon}
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors border",
            c.active
              ? "bg-accent-soft text-accent border-[color-mix(in_oklab,var(--accent),transparent_60%)]"
              : c.soon
                ? "bg-bg-1 text-fg-muted border-border opacity-60 cursor-not-allowed"
                : "bg-bg-1 text-fg-mid border-border hover:text-fg hover:border-border-strong"
          )}
        >
          {c.label}
          {"badge" in c && c.badge && (
            <span className="inline-flex items-center h-4 px-1.5 rounded-[4px] bg-bg-2 text-[9px] font-mono text-fg-mid">
              {c.badge}
            </span>
          )}
          {c.soon && (
            <span className="inline-flex items-center h-4 px-1.5 rounded-[4px] bg-bg-2 text-[9px] font-mono uppercase tracking-[0.1em] text-accent/70">
              Soon
            </span>
          )}
        </button>
      ))}
    </div>
  );
}


/* ── Table row ──────────────────────────────────────────────────────────── */
function MarketRow({ market }: { market: Market }) {
  const oracle = useLiveOracle(market.id);
  const funding = useLiveFunding(market.id);
  const setMarket = useUi((s) => s.setSelectedMarket);

  const price = oracle ? Number(oracle.priceX18) : null;
  const fundingPct = funding ? funding.currentRateBps / 100 : null;
  const change = pseudoChange(market);
  const volume = pseudoVolume(market) * 1_000_000;

  return (
    <Link
      href={`/trade/${market.id}`}
      onClick={() => setMarket(market.id)}
      className="grid md:grid-cols-[1.5fr_repeat(5,1fr)_auto] grid-cols-2 gap-3 px-5 h-16 border-b border-border last:border-b-0 items-center hover:bg-bg-2 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <CoinIcon marketId={market.id as MarketId} size={40} />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm text-fg font-medium truncate">{market.base}-PERP</span>
          <span className="text-[11px] text-fg-muted truncate">Cross-margin · Tick {market.tickSize}</span>
        </div>
      </div>
      <div className="md:text-right text-right">
        <NumberDisplay value={price} decimals={2} prefix="$" />
      </div>
      <div className="hidden md:flex justify-end">
        <NumberDisplay value={change} decimals={2} signed suffix="%" colorBySign />
      </div>
      <div className="hidden md:flex justify-end">
        <NumberDisplay value={volume} decimals={0} prefix="$" />
      </div>
      <div className="hidden md:flex justify-end">
        <span className={cn("font-mono text-xs tabular-nums", (fundingPct ?? 0) >= 0 ? "text-long" : "text-short")}>
          {fundingPct !== null ? `${fundingPct.toFixed(4)}%` : "—"}
        </span>
      </div>
      <div className="hidden md:block text-right text-fg-mid text-xs">{market.maxLeverage}×</div>
      <div className="hidden md:flex justify-end">
        <span className="inline-flex items-center h-7 px-3 text-[11px] text-accent rounded-[var(--radius-sm)] bg-accent-soft border border-[color-mix(in_oklab,var(--accent),transparent_60%)]">
          Trade
        </span>
      </div>
    </Link>
  );
}

/* ── Sparkline ──────────────────────────────────────────────────────────── */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const w = 240;
  const h = 56;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const sx = (i: number) => (i / (points.length - 1)) * w;
  const sy = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const area = `${path} L ${w},${h} L 0,${h} Z`;
  const id = `sparkfill-${color.replace(/[^a-z]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="relative w-full h-12">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useSparkline(anchor: number, marketId: string) {
  const [series, setSeries] = useState<number[]>(() => seed(anchor, 32, marketId));
  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const next = last + (Math.random() - 0.5) * (anchor * 0.001);
        return [...prev.slice(1), next];
      });
    }, 1400);
    return () => clearInterval(id);
  }, [anchor]);
  return series;
}

function seed(anchor: number, n: number, salt: string): number[] {
  let v = anchor;
  const out: number[] = [];
  const seedNum = salt.charCodeAt(0) + salt.charCodeAt(salt.length - 1);
  for (let i = 0; i < n; i++) {
    v += ((Math.sin(i * 0.7 + seedNum) + Math.random() * 0.4 - 0.2) * (anchor * 0.003));
    out.push(v);
  }
  return out;
}

/* ── Deterministic per-market synthetic stats (so sort actually segregates) */
function hashBase(market: Market): number {
  let h = 0;
  for (const c of market.base) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function pseudoChange(market: Market): number {
  // -8% to +8%, deterministic
  return ((hashBase(market) % 1601) - 800) / 100;
}
function pseudoVolume(market: Market): number {
  // millions of USDC, deterministic, varies per market
  return 8 + (hashBase(market) % 90);
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5" />
    </svg>
  );
}

const BASE_GLOW: Partial<Record<MarketId, string>> = {
  "btc-usd": "radial-gradient(circle, rgba(247,147,26,0.6), transparent 70%)",
  "eth-usd": "radial-gradient(circle, rgba(98,126,234,0.6), transparent 70%)",
  "sol-usd": "radial-gradient(circle, rgba(20,241,149,0.6), transparent 70%)",
};

const BASE_LINE: Partial<Record<MarketId, string>> = {
  "btc-usd": "rgba(247,147,26,0.7)",
  "eth-usd": "rgba(98,126,234,0.7)",
  "sol-usd": "rgba(20,241,149,0.7)",
};
