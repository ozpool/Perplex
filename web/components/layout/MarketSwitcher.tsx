"use client";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import type { MarketId } from "@/lib/types/contract";
import { useMarkets } from "@/lib/api/queries";
import { useLiveOracle } from "@/lib/ws/channels";
import { NumberDisplay } from "@/components/ui/NumberDisplay";
import { CoinIcon } from "@/components/markets/CoinIcon";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/cn";

const BASE_LABEL: Record<MarketId, string> = {
  "btc-usd": "BTC",
  "eth-usd": "ETH",
  "sol-usd": "SOL",
};

const ICON: Record<MarketId, string> = {
  "btc-usd": "#f7931a",
  "eth-usd": "#627eea",
  "sol-usd": "#14f195",
};

export function MarketSwitcher({ marketId }: { marketId: MarketId }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const setMarket = useUi((s) => s.setSelectedMarket);
  const { data } = useMarkets();
  const markets = useMemo(() => data?.markets ?? [], [data]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 h-11 px-3 -mx-3 hover:bg-bg-2 rounded-[var(--radius-md)] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CoinIcon marketId={marketId} size={32} />
        <div className="flex flex-col text-left">
          <span className="text-[15px] font-semibold text-fg leading-tight">{BASE_LABEL[marketId]}-PERP</span>
          <span className="text-[10px] text-fg-muted leading-tight">Perpetual · 20x</span>
        </div>
        <ChevronDown />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute left-0 top-[calc(100%+4px)] z-40 w-72 panel panel-raised p-1.5 shadow-[var(--shadow-elev-2)]"
            role="listbox"
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-fg-muted">Markets</div>
            <div className="flex flex-col">
              {markets.map((m) => (
                <MarketRow
                  key={m.id}
                  marketId={m.id}
                  selected={m.id === marketId}
                  onClick={() => {
                    setMarket(m.id);
                    setOpen(false);
                    router.push(`/trade/${m.id}`);
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MarketRow({
  marketId,
  selected,
  onClick,
}: {
  marketId: MarketId;
  selected: boolean;
  onClick: () => void;
}) {
  const oracle = useLiveOracle(marketId);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-3 h-12 px-2 rounded-[var(--radius-sm)] text-left",
        selected ? "bg-accent-soft" : "hover:bg-bg-hover"
      )}
      role="option"
      aria-selected={selected}
    >
      <div className="flex items-center gap-2.5">
        <CoinIcon marketId={marketId} size={32} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm text-fg font-medium">{BASE_LABEL[marketId]}-PERP</span>
          <span className="text-[10px] text-fg-muted">Cross-margin</span>
        </div>
      </div>
      <NumberDisplay value={oracle?.priceX18 ?? null} decimals={2} size="sm" prefix="$" />
    </button>
  );
}

export function MarketBadge({ marketId }: { marketId: MarketId }) {
  const color = ICON[marketId];
  return (
    <div
      className="size-7 rounded-full flex items-center justify-center text-[10px] font-bold border border-border"
      style={{
        background: `radial-gradient(circle at 30% 30%, ${color}40, transparent 70%), var(--bg-2)`,
        color,
      }}
      aria-hidden
    >
      {BASE_LABEL[marketId]}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-fg-muted">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
