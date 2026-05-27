"use client";
import { usePositions, useBalance } from "@/lib/api/queries";
import { Card, CardHeader } from "@/components/ui/Card";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { usdc6ToDollars, x18ToDollars } from "@/lib/format/number";
import { cn } from "@/lib/cn";

export default function PortfolioPage() {
  const { data: positions, isLoading } = usePositions();
  const { data: balance } = useBalance();

  const collateral = positions ? usdc6ToDollars(positions.collateralUsdc) : 0;
  const free = positions ? usdc6ToDollars(positions.freeCollateralUsdc) : 0;
  const used = collateral - free;
  const notional = positions ? usdc6ToDollars(positions.totalNotionalUsdc) : 0;
  const pnl = positions ? usdc6ToDollars(positions.totalUnrealisedPnlUsdc) : 0;
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
          <div className="p-3">
            <EmptyState
              title="Equity history pending"
              description="Real per-hour equity will plot here once the /v1/portfolio/equity endpoint ships. Live equity above is real and on-chain."
              compact
            />
          </div>
        </Card>

        <Card raised>
          <CardHeader>Margin breakdown</CardHeader>
          <div className="p-4 flex flex-col gap-3">
            <Bar label="Used margin" value={used} max={collateral} color="var(--warn)" />
            <Bar label="Free collateral" value={free} max={collateral} color="var(--long)" />
            <Bar label="Wallet USDC" value={balance ? usdc6ToDollars(balance.walletUsdcBalance) : 0} max={collateral} color="var(--accent)" />
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
                    <td className="px-4 py-3 text-right"><NumberDisplay value={usdc6ToDollars(p.notionalUsdc)} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={x18ToDollars(p.entryPriceX18)} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={x18ToDollars(p.markPriceX18)} decimals={2} prefix="$" /></td>
                    <td className="px-4 py-3 text-right"><NumberDisplay value={usdc6ToDollars(p.unrealisedPnlUsdc)} decimals={2} signed prefix="$" colorBySign /></td>
                    <td className="px-4 py-3 text-right text-warn">
                      <NumberDisplay value={x18ToDollars(p.liquidationPriceX18)} decimals={2} prefix="$" className="text-warn" />
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

