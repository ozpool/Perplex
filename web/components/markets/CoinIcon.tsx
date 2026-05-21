import type { MarketId } from "@/lib/types/contract";

const STYLE: Record<string, { bg: string; fg: string }> = {
  "btc-usd": { bg: "#f7931a", fg: "#ffffff" },
  "eth-usd": { bg: "#627eea", fg: "#ffffff" },
  "sol-usd": { bg: "#000000", fg: "#14f195" },
};

interface Props {
  marketId: MarketId;
  size?: number;
  className?: string;
}

export function CoinIcon({ marketId, size = 36, className }: Props) {
  const palette = STYLE[marketId] ?? { bg: "#1a1830", fg: "#ffffff" };
  return (
    <div
      aria-hidden
      style={{ width: size, height: size, background: palette.bg }}
      className={"rounded-full inline-flex items-center justify-center shrink-0 shadow-[inset_0_-1px_2px_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.18)] " + (className ?? "")}
    >
      {marketId === "btc-usd" && <BtcMark size={Math.round(size * 0.58)} color={palette.fg} />}
      {marketId === "eth-usd" && <EthMark size={Math.round(size * 0.6)} color={palette.fg} />}
      {marketId === "sol-usd" && <SolMark size={Math.round(size * 0.58)} color={palette.fg} />}
    </div>
  );
}

function BtcMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path
        fill={color}
        d="M21.66 14.36c.34-2.27-1.39-3.49-3.76-4.31l.77-3.09-1.88-.47-.75 3.01c-.49-.12-1-.24-1.5-.35l.75-3.03-1.88-.47-.77 3.09c-.41-.09-.81-.18-1.2-.28v-.01l-2.6-.65-.5 2.01s1.4.32 1.37.34c.76.19.9.7.88 1.1l-.88 3.52c.05.01.12.03.2.06l-.2-.05-1.23 4.93c-.09.23-.33.58-.86.45.02.03-1.37-.34-1.37-.34l-.93 2.15 2.45.61c.46.11.9.23 1.34.34l-.78 3.13 1.88.47.77-3.09c.51.14 1.01.26 1.5.38l-.77 3.07 1.88.47.78-3.12c3.21.61 5.62.36 6.64-2.55.82-2.34-.04-3.69-1.73-4.57 1.23-.28 2.16-1.09 2.41-2.77zm-4.31 6.04c-.58 2.34-4.52 1.07-5.8.75l1.03-4.14c1.28.32 5.38.95 4.77 3.39zm.59-6.08c-.53 2.13-3.81 1.05-4.87.78l.94-3.75c1.07.27 4.49.77 3.93 2.97z"
      />
    </svg>
  );
}

function EthMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <g fill={color}>
        <path opacity="0.6" d="M16 3l-9 14 9 5z" />
        <path d="M16 3l9 14-9 5z" />
        <path opacity="0.6" d="M16 24l9-5-9 12z" />
        <path d="M16 31l-9-12 9 5z" />
        <path opacity="0.45" d="M16 22l9-5-9-4z" />
        <path opacity="0.85" d="M7 17l9 5v-9z" />
      </g>
    </svg>
  );
}

function SolMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="sol-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      <path fill="url(#sol-a)" d="M9 23h17l-3 4H6zM9 9h17l-3 4H6zM6 16l3-4h17l-3 4z" />
    </svg>
  );
}
