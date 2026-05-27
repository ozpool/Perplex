"use client";
import { useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { usePositions, useOpenOrders, useFills, useCancelOrder } from "@/lib/api/queries";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { EmptyState } from "@/components/common/EmptyState";
import { formatTimeOfDay, formatDateTime, usdc6ToDollars, x18ToDollars } from "@/lib/format/number";
import { Button } from "@/components/ui/Button";
import { useUi } from "@/lib/store/ui-store";
import { useClosePosition } from "@/lib/trade/use-close-position";
import { cn } from "@/lib/cn";
import type { MarketId } from "@/lib/types/contract";

type Tab = "positions" | "orders" | "fills";

export function PositionPanel({ marketId }: { marketId?: MarketId }) {
  const [tab, setTab] = useState<Tab>("positions");
  const [scope, setScope] = useState<"current" | "all">("current");
  const { data: positions } = usePositions();
  const { data: orders } = useOpenOrders();
  const { data: fillsResp } = useFills(scope === "current" ? marketId : undefined);
  const optimistic = useUi((s) => s.optimisticOrders);
  const cancel = useCancelOrder();
  const pushToast = useUi((s) => s.pushToast);

  const filteredPositions = (positions?.positions ?? []).filter(
    (p) => scope === "all" || !marketId || p.marketId === marketId
  );
  const filteredOrders = (orders?.orders ?? []).filter(
    (o) => scope === "all" || !marketId || o.marketId === marketId
  );
  const filteredOptimistic = optimistic.filter(
    (o) => scope === "all" || !marketId || o.marketId === marketId
  );

  const ordersCount = filteredOrders.length + filteredOptimistic.length;
  const positionsCount = filteredPositions.length;
  const fillsCount = fillsResp?.fills.length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 border-b border-border flex items-center justify-between gap-3">
        <Tabs<Tab>
          variant="underline"
          value={tab}
          onChange={setTab}
          items={[
            { value: "positions", label: "Positions", count: positionsCount },
            { value: "orders", label: "Open orders", count: ordersCount },
            { value: "fills", label: "Fills", count: fillsCount },
          ]}
        />
        {marketId && (
          <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-bg-2 border border-border shrink-0">
            {(["current", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "px-2.5 h-6 rounded-full text-[10px] font-medium uppercase tracking-[0.1em] transition-colors",
                  scope === s ? "bg-accent-soft text-accent" : "text-fg-mid hover:text-fg"
                )}
              >
                {s === "current" ? `${marketId.split("-")[0]}` : "All"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "positions" && (
          <PositionsTable positions={filteredPositions} />
        )}
        {tab === "orders" && (
          <OrdersTable
            orders={filteredOrders}
            optimistic={filteredOptimistic}
            onCancel={async (id) => {
              try {
                await cancel.mutateAsync(id);
                pushToast({ kind: "success", title: "Order cancelled" });
              } catch (e) {
                pushToast({
                  kind: "error",
                  title: "Cancel failed",
                  body: e instanceof Error ? e.message : undefined,
                });
              }
            }}
          />
        )}
        {tab === "fills" && <FillsTable fills={fillsResp?.fills ?? []} />}
      </div>
    </div>
  );
}

function PositionsTable({ positions }: { positions: import("@/lib/types/contract").Position[] }) {
  const closePosition = useClosePosition();
  const [closingId, setClosingId] = useState<string | null>(null);

  if (positions.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="No open positions" description="Place an order to open a long or short position." />
      </div>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-fg-muted bg-bg-1/50 sticky top-0">
          <Th>Market</Th>
          <Th>Side</Th>
          <Th align="right">Size</Th>
          <Th align="right">Entry</Th>
          <Th align="right">Mark</Th>
          <Th align="right">Notional</Th>
          <Th align="right">PnL</Th>
          <Th align="right">Leverage</Th>
          <Th align="right">Liq. price</Th>
          <Th align="right">Funding</Th>
          <Th align="right" />
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.marketId} className="border-t border-border hover:bg-bg-2">
            <Td>{p.marketId.replace("-", "/").toUpperCase()}</Td>
            <Td>
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 h-5 rounded-[var(--radius-xs)] text-[10px] font-semibold",
                  p.side === "long" ? "bg-long-soft text-long" : "bg-short-soft text-short"
                )}
              >
                {p.side === "long" ? "LONG" : "SHORT"}
              </span>
            </Td>
            <Td align="right"><NumberDisplay value={p.size} decimals={4} /></Td>
            <Td align="right"><NumberDisplay value={x18ToDollars(p.entryPriceX18)} decimals={2} prefix="$" /></Td>
            <Td align="right"><NumberDisplay value={x18ToDollars(p.markPriceX18)} decimals={2} prefix="$" /></Td>
            <Td align="right"><NumberDisplay value={usdc6ToDollars(p.notionalUsdc)} decimals={2} prefix="$" /></Td>
            <Td align="right">
              <NumberDisplay
                value={usdc6ToDollars(p.unrealisedPnlUsdc)}
                decimals={2}
                prefix="$"
                signed
                colorBySign
              />
            </Td>
            <Td align="right">{Number(p.leverage).toFixed(1)}x</Td>
            <Td align="right" className="text-warn">
              <NumberDisplay value={x18ToDollars(p.liquidationPriceX18)} decimals={2} prefix="$" className="text-warn" />
            </Td>
            <Td align="right">
              <NumberDisplay value={usdc6ToDollars(p.fundingPaidUsdc)} decimals={2} prefix="$" signed colorBySign />
            </Td>
            <Td align="right">
              <Button
                size="sm"
                variant="danger"
                disabled={closingId === p.marketId}
                onClick={async () => {
                  setClosingId(p.marketId);
                  try {
                    await closePosition(p);
                  } finally {
                    setClosingId(null);
                  }
                }}
              >
                {closingId === p.marketId ? "Closing…" : "Close"}
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrdersTable({
  orders,
  optimistic,
  onCancel,
}: {
  orders: import("@/lib/types/contract").OpenOrder[];
  optimistic: import("@/lib/store/ui-store").OptimisticOrder[];
  onCancel: (id: string) => void;
}) {
  const total = orders.length + optimistic.length;
  if (total === 0) {
    return (
      <div className="p-6">
        <EmptyState title="No open orders" description="Place a limit order to see it here." />
      </div>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-fg-muted bg-bg-1/50 sticky top-0">
          <Th>Time</Th>
          <Th>Market</Th>
          <Th>Side</Th>
          <Th>Type</Th>
          <Th align="right">Price</Th>
          <Th align="right">Filled / Size</Th>
          <Th align="right">Total</Th>
          <Th align="right" />
        </tr>
      </thead>
      <tbody>
        {optimistic.map((o) => (
          <tr key={o.id} className="border-t border-border bg-accent-soft/30">
            <Td><span className="text-fg-muted">{formatTimeOfDay(o.tsNs)}</span></Td>
            <Td>{o.marketId.toUpperCase()}</Td>
            <Td className={o.side === "buy" ? "text-long" : "text-short"}>{o.side === "buy" ? "Long" : "Short"}</Td>
            <Td>
              <span className="inline-flex items-center gap-1">
                {o.type}
                <span className="text-[10px] text-accent">syncing…</span>
              </span>
            </Td>
            <Td align="right"><NumberDisplay value={o.price} decimals={2} /></Td>
            <Td align="right">
              <NumberDisplay value={Number(o.qty) - Number(o.remaining)} decimals={4} className="text-fg-mid" /> /{" "}
              <NumberDisplay value={o.qty} decimals={4} />
            </Td>
            <Td align="right"><NumberDisplay value={Number(o.price) * Number(o.qty)} decimals={2} prefix="$" /></Td>
            <Td align="right" />
          </tr>
        ))}
        {orders.map((o) => (
          <tr key={o.id} className="border-t border-border hover:bg-bg-2">
            <Td><span className="text-fg-muted">{formatTimeOfDay(o.tsNs)}</span></Td>
            <Td>{o.marketId.toUpperCase()}</Td>
            <Td className={o.side === "buy" ? "text-long" : "text-short"}>{o.side === "buy" ? "Long" : "Short"}</Td>
            <Td>{o.type}</Td>
            <Td align="right"><NumberDisplay value={o.price} decimals={2} /></Td>
            <Td align="right">
              <NumberDisplay value={Number(o.qty) - Number(o.remaining)} decimals={4} className="text-fg-mid" /> /{" "}
              <NumberDisplay value={o.qty} decimals={4} />
            </Td>
            <Td align="right"><NumberDisplay value={Number(o.price) * Number(o.qty)} decimals={2} prefix="$" /></Td>
            <Td align="right">
              <Button size="sm" variant="ghost" onClick={() => onCancel(o.id)}>
                Cancel
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FillsTable({ fills }: { fills: import("@/lib/types/contract").Fill[] }) {
  if (fills.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="No fills yet" description="Recent trades will appear here once you trade." />
      </div>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-fg-muted bg-bg-1/50 sticky top-0">
          <Th>Time</Th>
          <Th>Market</Th>
          <Th>Side</Th>
          <Th align="right">Price</Th>
          <Th align="right">Size</Th>
          <Th align="right">Total</Th>
          <Th align="right">Fee</Th>
          <Th>Role</Th>
        </tr>
      </thead>
      <tbody>
        {fills.map((f) => (
          <tr key={f.id} className="border-t border-border hover:bg-bg-2">
            <Td>{formatDateTime(f.tsNs)}</Td>
            <Td>{f.marketId.toUpperCase()}</Td>
            <Td className={f.side === "buy" ? "text-long" : "text-short"}>{f.side === "buy" ? "Buy" : "Sell"}</Td>
            <Td align="right"><NumberDisplay value={f.price} decimals={2} /></Td>
            <Td align="right"><NumberDisplay value={f.qty} decimals={4} /></Td>
            <Td align="right"><NumberDisplay value={Number(f.price) * Number(f.qty)} decimals={2} prefix="$" /></Td>
            <Td align="right"><NumberDisplay value={usdc6ToDollars(f.feeUsdc)} decimals={2} prefix="$" /></Td>
            <Td className="text-fg-muted">{f.role}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-3 py-2 font-medium text-[10px] uppercase tracking-wider",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </td>
  );
}
