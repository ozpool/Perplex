"use client";
import { useMemo, useState } from "react";
import { useAccount, useSignTypedData, useConnect } from "wagmi";
import type { Market, MarketId, OrderRequest, Side, TimeInForce } from "@/lib/types/contract";
import { usePlaceOrder } from "@/lib/api/queries";
import { useLiveOracle } from "@/lib/ws/channels";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { useUi } from "@/lib/store/ui-store";
import {
  buildOrderTypedMessage,
  ORDER_DOMAIN,
  ORDER_TYPES,
} from "@/lib/eip712/order";
import { nowTsNs } from "@/lib/format/number";
import { cn } from "@/lib/cn";

interface Props {
  marketId: MarketId;
  market: Market | undefined;
  freeCollateralUsdc: string | undefined;
}

type OrderTypeUi = "market" | "limit";

const LEVERAGE_PRESETS = [1, 2, 5, 10, 20];

const SETTLEMENT_PLACEHOLDER = "0x0000000000000000000000000000000000000000" as const;

export function OrderForm({ marketId, market, freeCollateralUsdc }: Props) {
  const { address, status, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { connectors, connect, isPending: connecting } = useConnect();
  const place = usePlaceOrder();
  const oracle = useLiveOracle(marketId);

  const pushToast = useUi((s) => s.pushToast);
  const addOpt = useUi((s) => s.addOptimisticOrder);
  const removeOpt = useUi((s) => s.removeOptimisticOrder);

  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<OrderTypeUi>("limit");
  const [priceInput, setPriceInput] = useState<string>("");
  const [qtyInput, setQtyInput] = useState<string>("");
  const [leverage, setLeverage] = useState<number>(2);
  const [tif, setTif] = useState<TimeInForce>("gtc");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);

  const oraclePx = oracle ? Number(oracle.priceX18) : null;
  // Fallback when the oracle WS hasn't ticked yet (no relayer running locally):
  // /v1/markets always carries the seed price as an x18 integer. Down-scale and
  // use it so the ticket math (quick-percent buttons, optimistic price) has a
  // sane anchor even before the first WS oracle frame. See #112.
  const markPx = oraclePx ?? (market ? Number(market.indexPriceX18) / 1e18 : null);
  const tickDec = market ? Math.max(2, decOf(market.tickSize)) : 2;
  const lotDec = market ? decOf(market.lotSize) : 4;

  if (type === "limit" && !priceInput && markPx) {
    setPriceInput(markPx.toFixed(tickDec));
  }

  const effPrice = useMemo(() => {
    if (type === "market") return markPx ?? 0;
    const n = Number(priceInput);
    return Number.isFinite(n) ? n : 0;
  }, [type, priceInput, markPx]);

  const qty = Number(qtyInput) || 0;
  const notional = effPrice * qty;
  const margin = leverage > 0 ? notional / leverage : 0;
  const feeBps = market?.takerFeeBps ?? 5;
  const fee = notional * (feeBps / 10000);
  const liqEst = sideLiqEstimate(side, effPrice, leverage, market);

  const free = freeCollateralUsdc ? Number(freeCollateralUsdc) : null;
  const insufficient = free !== null && margin > free;

  const canSubmit =
    status === "connected" &&
    market &&
    qty > 0 &&
    (type === "market" || effPrice > 0) &&
    !insufficient &&
    !place.isPending;

  async function onSubmit() {
    if (!market || !address) return;
    const clientOrderId = `cli_${Math.random().toString(36).slice(2, 12)}`;
    const nonce = nowTsNs();
    const orderTs = nonce;

    const optimisticPrice = type === "market" ? (markPx ?? 0).toFixed(tickDec) : priceInput;
    const optimisticQty = qty.toFixed(lotDec);

    addOpt({
      id: `opt_${clientOrderId}`,
      marketId,
      side,
      type,
      price: optimisticPrice,
      qty: optimisticQty,
      remaining: optimisticQty,
      tsNs: orderTs,
      clientOrderId,
      optimistic: true,
    });

    pushToast({ kind: "info", title: `${side === "buy" ? "Long" : "Short"} ${market.base} accepted`, body: `${optimisticQty} @ ${type === "market" ? "mkt" : optimisticPrice}` });

    let signature = "0x0000";
    try {
      if (chainId) {
        const message = buildOrderTypedMessage({
          owner: address,
          marketId,
          side,
          type,
          price: optimisticPrice,
          qty: optimisticQty,
          timeInForce: tif,
          reduceOnly,
          postOnly,
          nonce,
        });
        signature = await signTypedDataAsync({
          domain: ORDER_DOMAIN(chainId, SETTLEMENT_PLACEHOLDER),
          types: ORDER_TYPES,
          primaryType: "Order",
          message,
        });
      }
    } catch (e) {
      removeOpt(clientOrderId);
      pushToast({
        kind: "error",
        title: "Order rejected",
        body: e instanceof Error ? e.message : "Wallet signature failed",
      });
      return;
    }

    const req: OrderRequest = {
      marketId,
      side,
      type,
      price: optimisticPrice,
      qty: optimisticQty,
      timeInForce: tif,
      reduceOnly,
      postOnly,
      clientOrderId,
      nonce,
      signature,
    };

    try {
      await place.mutateAsync(req);
      removeOpt(clientOrderId);
      pushToast({
        kind: "success",
        title: type === "market" ? "Filled" : "Order placed",
        body: `${side === "buy" ? "Long" : "Short"} ${optimisticQty} ${market.base}`,
      });
      if (type === "market") setQtyInput("");
    } catch (e) {
      removeOpt(clientOrderId);
      const msg = e instanceof Error ? e.message : "Unknown error";
      pushToast({ kind: "error", title: "Order rejected", body: msg });
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-9 px-3 border-b border-border flex items-center text-[11px] text-fg-muted uppercase tracking-wider font-medium">
        Place order
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <SideButton side="buy" active={side === "buy"} onClick={() => setSide("buy")} />
        <SideButton side="sell" active={side === "sell"} onClick={() => setSide("sell")} />
      </div>

      <div className="px-3">
        <Tabs<OrderTypeUi>
          variant="segmented"
          value={type}
          onChange={setType}
          items={[
            { value: "market", label: "Market" },
            { value: "limit", label: "Limit" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
        {type === "limit" && (
          <Input
            label="Price"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            suffix="USD"
          />
        )}

        <div className="flex flex-col gap-1.5">
          <Input
            label="Size"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            suffix={market?.base ?? ""}
          />
          <div className="flex gap-1">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  if (!free || !effPrice || leverage <= 0) return;
                  const maxNotional = free * leverage;
                  const maxQty = maxNotional / effPrice;
                  setQtyInput((maxQty * (pct / 100)).toFixed(lotDec));
                }}
                className="flex-1 h-7 text-[11px] font-mono rounded-[var(--radius-xs)] border border-border text-fg-mid hover:text-accent hover:border-accent transition-colors"
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-fg-muted font-medium">Leverage</span>
            <span className="inline-flex items-center gap-1 font-mono text-[13px] text-fg">
              <span className="text-accent font-semibold">{leverage}</span>
              <span className="text-fg-muted">×</span>
            </span>
          </div>
          <div className="relative">
            <input
              type="range"
              min={1}
              max={market?.maxLeverage ?? 20}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full h-1 rounded-full appearance-none bg-bg-3 accent-[var(--accent)]"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${((leverage - 1) / ((market?.maxLeverage ?? 20) - 1)) * 100}%, var(--bg-3) ${((leverage - 1) / ((market?.maxLeverage ?? 20) - 1)) * 100}%, var(--bg-3) 100%)`,
              }}
              aria-label="Leverage"
            />
          </div>
          <div className="flex justify-between gap-1 mt-2">
            {LEVERAGE_PRESETS.filter((l) => l <= (market?.maxLeverage ?? 20)).map((l) => (
              <button
                key={l}
                onClick={() => setLeverage(l)}
                className={cn(
                  "flex-1 h-7 text-[11px] font-mono font-medium rounded-[var(--radius-xs)] border transition-colors",
                  leverage === l
                    ? "bg-accent-soft border-accent text-accent"
                    : "bg-bg-1 border-border text-fg-mid hover:text-fg hover:border-border-strong"
                )}
              >
                {l}×
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Toggle
            label="Reduce only"
            help="Order can only shrink your existing position, never flip or grow it."
            checked={reduceOnly}
            onChange={setReduceOnly}
          />
          <Toggle
            label="Post only"
            help="Cancel if this order would take liquidity (always rest as maker)."
            checked={postOnly}
            onChange={setPostOnly}
            disabled={type === "market"}
          />
        </div>

        {type === "limit" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1 text-fg-muted uppercase tracking-wider">
                Time in force
                <InfoDot />
              </span>
              <div className="flex gap-1">
                {(["gtc", "ioc", "fok"] as TimeInForce[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTif(t)}
                    className={cn(
                      "h-6 px-2 rounded-[var(--radius-xs)] uppercase font-mono text-[10px] font-medium border transition-colors",
                      tif === t ? "bg-accent-soft text-accent border-accent" : "text-fg-mid border-border hover:text-fg"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-fg-muted leading-snug">{TIF_HELP[tif]}</p>
          </div>
        )}

        <div className="rounded-[var(--radius-md)] bg-bg-1 border border-border p-3 flex flex-col gap-1.5 text-[11px]">
          <Row label="Order value" value={notional ? `$${commaFmt(notional, 2)}` : "—"} />
          <Row label="Margin required" value={margin ? `$${commaFmt(margin, 2)}` : "—"} highlight={insufficient ? "short" : undefined} />
          <Row label="Est. fee" value={fee ? `$${commaFmt(fee, 2)}` : "—"} muted />
          <div className="border-t border-border my-0.5" />
          <Row
            label="Liquidation price"
            value={liqEst !== null ? `$${commaFmt(liqEst, tickDec)}` : "—"}
            highlight={liqEst !== null ? "warn" : undefined}
          />
          <Row label="Free collateral" value={free !== null ? `$${commaFmt(free, 2)}` : "—"} muted />
        </div>
      </div>

      <div className="p-3 border-t border-border">
        {status !== "connected" ? (
          <Button
            block
            size="lg"
            variant="primary"
            loading={connecting}
            onClick={() => {
              const first = connectors[0];
              if (first) connect({ connector: first });
            }}
          >
            Connect wallet to trade
          </Button>
        ) : (
          <Button
            block
            size="lg"
            variant={side === "buy" ? "long" : "short"}
            loading={place.isPending}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {insufficient
              ? "Insufficient margin"
              : `${side === "buy" ? "Long" : "Short"} ${market?.base ?? ""}`}
          </Button>
        )}
      </div>
    </div>
  );
}

const TIF_HELP: Record<TimeInForce, string> = {
  gtc: "Good till cancelled · rests in the book until filled or you cancel it",
  ioc: "Immediate or cancel · fills what's available now, kills the rest",
  fok: "Fill or kill · fully fills instantly or rejects the entire order",
};

function InfoDot() {
  return (
    <span
      title="GTC: rests till filled. IOC: take what's there, kill rest. FOK: full fill or reject."
      className="inline-flex items-center justify-center size-3.5 rounded-full bg-bg-2 border border-border text-fg-mid font-mono text-[9px] cursor-help"
    >
      i
    </span>
  );
}

function Row({
  label,
  value,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  muted?: boolean;
  highlight?: "warn" | "short";
}) {
  const valueClass = highlight === "warn"
    ? "text-warn"
    : highlight === "short"
      ? "text-short font-semibold"
      : muted ? "text-fg-mid" : "text-fg";
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{label}</span>
      <span className={cn("font-mono tabular-nums", valueClass)}>{value}</span>
    </div>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      title={help}
      className={cn(
        "flex items-center justify-between gap-2 h-8 px-2 rounded-[var(--radius-sm)] border border-border cursor-pointer select-none transition-colors hover:border-border-strong",
        checked && "bg-accent-soft border-accent",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      <span className={cn(checked ? "text-accent font-medium" : "text-fg-mid")}>{label}</span>
      <span
        className={cn(
          "relative inline-block w-7 h-4 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-bg-3"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 bg-white rounded-full shadow-sm transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5"
          )}
        />
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
}

function SideButton({
  side,
  active,
  onClick,
}: {
  side: Side;
  active: boolean;
  onClick: () => void;
}) {
  const isLong = side === "buy";
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden h-12 rounded-[var(--radius-md)] text-[14px] font-semibold transition-all duration-150",
        active
          ? isLong
            ? "bg-gradient-to-br from-[#1ad094] to-[#0c8f63] text-white shadow-[0_2px_0_rgba(0,0,0,0.15),0_8px_22px_-6px_rgba(26,208,148,0.45),inset_0_1px_0_rgba(255,255,255,0.18)]"
            : "bg-gradient-to-br from-[#ff5a6a] to-[#c52030] text-white shadow-[0_2px_0_rgba(0,0,0,0.15),0_8px_22px_-6px_rgba(255,90,106,0.45),inset_0_1px_0_rgba(255,255,255,0.18)]"
          : isLong
            ? "bg-bg-2 text-fg-mid hover:text-long border border-border hover:border-[color-mix(in_oklab,var(--long),transparent_55%)]"
            : "bg-bg-2 text-fg-mid hover:text-short border border-border hover:border-[color-mix(in_oklab,var(--short),transparent_55%)]"
      )}
      aria-pressed={active}
    >
      {/* sheen */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0))",
          }}
        />
      )}
      <span className="relative inline-flex items-center justify-center gap-2">
        <span
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-full",
            active ? "bg-white/18" : isLong ? "bg-long-soft text-long" : "bg-short-soft text-short"
          )}
        >
          {isLong ? <UpArrow /> : <DownArrow />}
        </span>
        <span className="tracking-[0.02em]">{isLong ? "Long" : "Short"}</span>
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.16em] opacity-80 inline-flex items-center h-4 px-1.5 rounded-[4px]",
            active ? "bg-white/15" : "bg-bg-1 border border-border"
          )}
        >
          {isLong ? "BUY" : "SELL"}
        </span>
      </span>
    </button>
  );
}

function UpArrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function DownArrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  );
}

function decOf(s: string): number {
  const i = s.indexOf(".");
  if (i < 0) return 0;
  return s.length - i - 1;
}

function commaFmt(n: number, dec: number): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(dec);
  const [intP, decP] = fixed.split(".");
  const withCommas = intP.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decP ? `${withCommas}.${decP}` : withCommas;
}

function sideLiqEstimate(side: Side, price: number, leverage: number, market: Market | undefined): number | null {
  if (!price || !leverage || !market) return null;
  const mmRatio = market.mmRatioBps / 10000;
  if (side === "buy") {
    return price * (1 - 1 / leverage + mmRatio);
  }
  return price * (1 + 1 / leverage - mmRatio);
}
