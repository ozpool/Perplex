// Numeric formatting helpers. All inputs are decimal strings per contract.

// USDC values on the wire carry 6-decimal precision (matching the ERC-20).
// Every render site that wants a human dollar number must descale.
export function usdc6ToDollars(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return n / 1e6;
}

// Price/PnL fields that ship as x18 fixed-point (entry, mark, liquidation,
// oracle priceX18, indexPriceX18).
export function x18ToDollars(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return n / 1e18;
}

export function tickPrecision(tickSize: string): number {
  const i = tickSize.indexOf(".");
  if (i < 0) return 0;
  return tickSize.length - i - 1;
}

export function lotPrecision(lotSize: string): number {
  return tickPrecision(lotSize);
}

export function formatPrice(price: string | number, decimals: number, opts: { withCommas?: boolean } = {}): string {
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(decimals);
  if (!opts.withCommas) return fixed;
  const [intPart, dec] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${withCommas}.${dec}` : withCommas;
}

export function formatQty(qty: string | number, decimals: number): string {
  const n = typeof qty === "string" ? Number(qty) : qty;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export function formatUsd(value: string | number, decimals = 2): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${formatPrice(abs, decimals, { withCommas: true })}`;
}

export function formatSignedUsd(value: string | number, decimals = 2): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return `$0.${"0".repeat(decimals)}`;
  const sign = n > 0 ? "+" : "-";
  return `${sign}$${formatPrice(Math.abs(n), decimals, { withCommas: true })}`;
}

export function formatSignedPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return `0.${"0".repeat(decimals)}%`;
  const sign = value > 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

// Compact for big numbers: 1.2M, 845K, 2.1B
export function formatCompact(value: string | number, decimals = 2): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(decimals)}`;
}

// Format a ns-precision unix timestamp string to HH:MM:SS local
export function formatTimeOfDay(tsNs: string): string {
  const ms = Number(BigInt(tsNs) / 1_000_000n);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatDateTime(tsNs: string): string {
  const ms = Number(BigInt(tsNs) / 1_000_000n);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Countdown helper: returns mm:ss remaining until a ns timestamp
export function formatCountdown(targetTsNs: string, nowMs?: number): string {
  const targetMs = Number(BigInt(targetTsNs) / 1_000_000n);
  const cur = nowMs ?? Date.now();
  const remaining = Math.max(0, targetMs - cur);
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function nowTsNs(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

// Side helpers
export function sideColor(side: "buy" | "sell" | "long" | "short"): "long" | "short" {
  return side === "buy" || side === "long" ? "long" : "short";
}
