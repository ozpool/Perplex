"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { useFills, useBalance } from "@/lib/api/queries";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDateTime, usdc6ToDollars } from "@/lib/format/number";
import { cn } from "@/lib/cn";

type Tab = "fills" | "deposits" | "withdrawals" | "funding";

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>("fills");
  const { data: fills } = useFills();
  const { data: balance } = useBalance();

  return (
    <div className="px-3 sm:px-5 py-4 sm:py-6 max-w-screen-xl w-full mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl text-fg font-semibold">History</h1>
        <p className="text-sm text-fg-muted">Trades, transfers, and funding payments.</p>
      </div>

      <Card raised className="overflow-hidden">
        <div className="px-3 border-b border-border">
          <Tabs<Tab>
            variant="underline"
            value={tab}
            onChange={setTab}
            items={[
              { value: "fills", label: "Fills", count: fills?.fills.length ?? 0 },
              { value: "deposits", label: "Deposits", count: balance?.pendingDeposits.length ?? 0 },
              { value: "withdrawals", label: "Withdrawals", count: balance?.pendingWithdrawals.length ?? 0 },
              { value: "funding", label: "Funding", count: 0 },
            ]}
          />
        </div>

        {tab === "fills" && (
          fills && fills.fills.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fg-muted text-[10px] uppercase tracking-wider">
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Market</th>
                    <th className="text-left px-4 py-2">Side</th>
                    <th className="text-right px-4 py-2">Price</th>
                    <th className="text-right px-4 py-2">Size</th>
                    <th className="text-right px-4 py-2">Notional</th>
                    <th className="text-right px-4 py-2">Fee</th>
                    <th className="text-left px-4 py-2">Role</th>
                    <th className="text-left px-4 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.fills.map((f) => (
                    <tr key={f.id} className="border-t border-border hover:bg-bg-2">
                      <td className="px-4 py-2.5 text-fg-mid">{formatDateTime(f.tsNs)}</td>
                      <td className="px-4 py-2.5 text-fg">{f.marketId.toUpperCase()}</td>
                      <td className={cn("px-4 py-2.5", f.side === "buy" ? "text-long" : "text-short")}>
                        {f.side === "buy" ? "Buy" : "Sell"}
                      </td>
                      <td className="px-4 py-2.5 text-right"><NumberDisplay value={f.price} decimals={2} /></td>
                      <td className="px-4 py-2.5 text-right"><NumberDisplay value={f.qty} decimals={4} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <NumberDisplay value={Number(f.price) * Number(f.qty)} decimals={2} prefix="$" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <NumberDisplay value={usdc6ToDollars(f.feeUsdc)} decimals={2} prefix="$" />
                      </td>
                      <td className="px-4 py-2.5 text-fg-muted">{f.role}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-accent">
                        {f.txHash.slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8"><EmptyState title="No fills yet" description="Once you trade, your fills appear here." /></div>
          )
        )}

        {tab === "deposits" && (
          <TransferList items={balance?.pendingDeposits ?? []} emptyTitle="No deposits" emptyHint="Deposits will appear here once submitted." />
        )}
        {tab === "withdrawals" && (
          <TransferList items={balance?.pendingWithdrawals ?? []} emptyTitle="No withdrawals" emptyHint="Withdrawals will appear here once submitted." />
        )}
        {tab === "funding" && (
          <div className="p-8">
            <EmptyState title="No funding payments yet" description="Funding is applied every 8h while you hold a position." />
          </div>
        )}
      </Card>
    </div>
  );
}

function TransferList({
  items,
  emptyTitle,
  emptyHint,
}: {
  items: import("@/lib/types/contract").PendingTransfer[];
  emptyTitle: string;
  emptyHint: string;
}) {
  if (items.length === 0) {
    return (
      <div className="p-8">
        <EmptyState title={emptyTitle} description={emptyHint} />
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-muted text-[10px] uppercase tracking-wider">
            <th className="text-left px-4 py-2">Time</th>
            <th className="text-right px-4 py-2">Amount</th>
            <th className="text-left px-4 py-2">Tx</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-t border-border hover:bg-bg-2">
              <td className="px-4 py-2.5 text-fg-mid">{formatDateTime(t.tsNs)}</td>
              <td className="px-4 py-2.5 text-right">
                <NumberDisplay value={usdc6ToDollars(t.amountUsdc)} decimals={2} prefix="$" />
              </td>
              <td className="px-4 py-2.5 font-mono text-accent">{t.txHash.slice(0, 10)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
