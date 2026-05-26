"use client";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  42161: "Arbitrum",
  421614: "Arb Sepolia",
  31337: "Anvil",
};

// Deterministic avatar gradient from address
function avatarGradient(addr: string): string {
  const h = parseInt(addr.slice(2, 8), 16);
  const a = h % 360;
  const b = (a + 60) % 360;
  return `linear-gradient(135deg, hsl(${a},85%,60%) 0%, hsl(${b},90%,50%) 100%)`;
}

export function WalletButton() {
  const { address, status, connector } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const [open, setOpen] = useState(false);

  if (status === "connected" && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center gap-2 h-10 pl-1.5 pr-3 bg-bg-1 hover:bg-bg-2 border border-border hover:border-border-strong rounded-full text-sm text-fg transition-colors"
        >
          <span
            aria-hidden
            className="size-7 rounded-full ring-1 ring-border-strong shrink-0"
            style={{ background: avatarGradient(address) }}
          />
          <span className="font-mono text-xs">{shortAddr(address)}</span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-fg-mid pl-2 ml-1 border-l border-border">
            <span className="size-1.5 rounded-full bg-long pulse-dot" />
            {CHAIN_LABEL[chainId] ?? chainId}
          </span>
          <ChevronIcon />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-72 panel panel-raised p-3 shadow-[var(--shadow-elev-2)] rounded-[var(--radius-lg)]">
              <div className="flex items-center gap-3 pb-3 border-b border-border">
                <span
                  aria-hidden
                  className="size-10 rounded-full ring-1 ring-border-strong shrink-0"
                  style={{ background: avatarGradient(address) }}
                />
                <div className="min-w-0">
                  <div className="font-mono text-[13px] text-fg">{shortAddr(address)}</div>
                  <div className="text-[11px] text-fg-muted truncate">
                    {connector?.name} · {CHAIN_LABEL[chainId] ?? chainId}
                  </div>
                </div>
              </div>
              <div className="pt-2 flex flex-col gap-1">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(address);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius-sm)] text-sm text-fg hover:bg-bg-hover transition-colors"
                >
                  <CopyIcon />
                  Copy address
                </button>
                <a
                  href={`https://arbiscan.io/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius-sm)] text-sm text-fg hover:bg-bg-hover transition-colors"
                >
                  <ExternalIcon />
                  View on Arbiscan
                </a>
                <button
                  onClick={() => {
                    disconnect();
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius-sm)] text-sm text-short hover:bg-short-soft transition-colors"
                >
                  <PowerIcon />
                  Disconnect
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="group inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full bg-accent hover:bg-accent-strong text-white text-[13px] font-semibold transition-colors shadow-[0_2px_6px_rgba(255,107,26,0.32),0_10px_24px_-12px_rgba(255,107,26,0.55)] disabled:opacity-60"
      >
        <span className="inline-flex items-center justify-center size-6 rounded-full bg-white/15">
          {isPending ? <SpinnerIcon /> : <WalletIcon />}
        </span>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-72 panel panel-raised p-3 shadow-[var(--shadow-elev-2)] rounded-[var(--radius-lg)]">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-[13px] font-semibold text-fg">Choose wallet</div>
              <span className="inline-flex items-center h-5 px-2 rounded-full bg-bg-2 text-[10px] text-fg-mid">
                EVM only
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  onClick={() => {
                    connect({ connector: c });
                    setOpen(false);
                  }}
                  className="group flex items-center gap-3 px-2 h-11 rounded-[var(--radius-sm)] text-sm text-fg hover:bg-bg-hover transition-colors"
                >
                  <ConnectorIcon name={c.name} />
                  <span className="text-[13px] font-medium">{c.name}</span>
                  <span className="ml-auto text-fg-muted group-hover:text-accent transition-colors">
                    <ChevronRightIcon />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
function WalletIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h15a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      <path d="M3 7l2-3h12l2 3" />
      <circle cx="17" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-fg-muted group-hover:text-fg transition-colors">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 4h6v6M20 4l-9 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" />
    </svg>
  );
}
function PowerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3v9" />
      <path d="M7 6a8 8 0 1010 0" />
    </svg>
  );
}
function SpinnerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
      <path d="M21 12a9 9 0 01-9 9" strokeLinecap="round" />
    </svg>
  );
}

function ConnectorIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("metamask")) return <Glyph color="#f6851b">M</Glyph>;
  if (lower.includes("walletconnect")) return <Glyph color="#3b99fc">W</Glyph>;
  if (lower.includes("coinbase")) return <Glyph color="#0052ff">C</Glyph>;
  if (lower.includes("rabby")) return <Glyph color="#7084ff">R</Glyph>;
  if (lower.includes("safe")) return <Glyph color="#12ff80">S</Glyph>;
  if (lower.includes("injected")) return <Glyph color="#9ca3af">⌬</Glyph>;
  return <Glyph color="#5e35b1">{name[0]}</Glyph>;
}
function Glyph({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center size-7 rounded-[8px] text-[13px] font-bold text-white shrink-0"
      style={{ background: color }}
    >
      {children}
    </span>
  );
}
