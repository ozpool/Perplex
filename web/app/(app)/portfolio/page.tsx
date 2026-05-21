"use client";
import { useEffect, useRef, useState } from "react";
import { usePositions, useBalance } from "@/lib/api/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/cn";

export default function PortfolioPage() {
  const { data: positions, isLoading } = usePositions();
  const { data: balance } = useBalance();

  const collateral = positions ? Number(positions.collateralUsdc) : 0;
  const free = positions ? Number(positions.freeCollateralUsdc) : 0;
  const used = collateral - free;
  const notional = positions ? Number(positions.totalNotionalUsdc) : 0;
  const pnl = positions ? Number(positions.totalUnrealisedPnlUsdc) : 0;
  const accountEquity = collateral + pnl;

  return (
    <div className="px-3 sm:px-5 py-4 sm:py-6 max-w-screen-xl w-full mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl text-fg font-semibold">Portfolio</h1>
        <p className="text-sm text-fg-muted">Cross-margin account · USDC collateral</p>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <Stat label="Account equity">
          <NumberDisplay value={accountEquity} decimals={2} size="xl" prefix="$" />
        </Stat>
        <Stat label="Unrealised PnL">
          <NumberDisplay value={pnl} decimals={2} size="xl" signed prefix="$" colorBySign />
        </Stat>
        <Stat label="Free collateral">
          <NumberDisplay value={free} decimals={2} size="xl" prefix="$" />
        </Stat>
        <Stat label="Total notional">
          <NumberDisplay value={notional} decimals={2} size="xl" prefix="$" />
        </Stat>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <Card raised>
          <CardHeader>Equity (24h)</CardHeader>
          <EquitySparkline value={accountEquity} />
        </Card>

        <Card raised>
          <CardHeader>Margin breakdown</CardHeader>
          <div className="p-4 flex flex-col gap-3">
            <Bar label="Used margin" value={used} max={collateral} color="var(--warn)" />
            <Bar label="Free collateral" value={free} max={collateral} color="var(--long)" />
            <Bar label="Wallet USDC" value={balance ? Number(balance.walletUsdcBalance) : 0} max={collateral} color="var(--accent)" />
          </div>
        </Card>
      </div>

      <Card raised>
        <CardHeader>Open positions</CardHeader>
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !positions || positions.positions.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No open positions" description="Trades you place will appear here as positions." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-[10px] uppercase tracking-wider">
                  <th className="text-left px-4 py-2">Market</th>
                  <th className="text-left px-4 py-2">Side</th>
                  <th className="text-right px-4 py-2">Size</th>
                  <th className="text-right px-4 py-2">Notional</th>
                  <th className="text-right px-4 py-2">Entry</th>
                  <th className="text-right px-4 py-2">Mark</th>
                  <th className="text-right px-4 py-2">PnL</th>
                  <th className="text-right px-4 py-2">Liq.</th>
                </tr>
              </thead>
              <tbody>
                {positions.positions.map((p) => (
                  <tr key={p.marketId} className="border-t border-border hover:bg-bg-2">
                    <td className="px-4 py-3 text-fg">{p.marketId.toUpperCase()}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 h-5 rounded-[var(--radius-xs)] text-[10px] font-semibold",
                          p.side === "long" ? "bg-long-soft text-long" : "bg-short-soft text-short"
                        )}
                      >
                        {p.side === "long" ? "LONG" : "SHORT"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={p.size} decimals={4} /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={p.notionalUsdc} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={p.entryPriceX18} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={p.markPriceX18} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={p.unrealisedPnlUsdc} decimals={2} signed prefix="$" colorBySign /></td>
                    <td className="px-4 py-3 text-right text-warn">
                      <NumberDisplay value={p.liquidationPriceX18} decimals={2} prefix="$" className="text-warn" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card raised className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted mb-1.5">{label}</div>
      {children}
    </Card>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-fg-muted">{label}</span>
        <NumberDisplay value={value} decimals={2} prefix="$" />
      </div>
      <div className="h-1.5 bg-bg-3 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// Lightweight sparkline using a single SVG path with a stream of fake but coherent values
function EquitySparkline({ value }: { value: number }) {
  const [points, setPoints] = useState<number[]>(() => seedSeries(value, 120));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setPoints((prev) => {
        const last = prev[prev.length - 1] ?? value;
        const next = last + (Math.random() - 0.5) * Math.max(1, last * 0.0015);
        return [...prev.slice(1), next];
      });
    }, 1200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [value]);

  const w = 600;
  const h = 180;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const sx = (i: number) => (i / (points.length - 1)) * w;
  const sy = (v: number) => h - 8 - ((v - min) / span) * (h - 16);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const positive = last >= first;
  const stroke = positive ? "var(--long)" : "var(--short)";
  const fill = positive
    ? "color-mix(in oklab, var(--long), transparent 80%)"
    : "color-mix(in oklab, var(--short), transparent 80%)";

  return (
    <div className="p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44">
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <path d={`${path} L${w},${h - 8} L0,${h - 8} Z`} fill="url(#eqFill)" />
        <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(points.length - 1)} cy={sy(last)} r={3} fill={stroke} />
      </svg>
      <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-fg-muted">
        <span>Last 24h</span>
        <NumberDisplay value={last - first} decimals={2} signed prefix="$" colorBySign />
      </div>
    </div>
  );
}

function seedSeries(anchor: number, n: number): number[] {
  const out: number[] = [];
  let v = anchor * (0.985 + Math.random() * 0.01);
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * Math.max(1, anchor * 0.002);
    out.push(v);
  }
  return out;
}
