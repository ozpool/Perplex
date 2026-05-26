"use client";
import { useEffect, useState } from "react";

// Floating ETH-PERP ticker — mirrors PriceTile shape on the left side.
// Initial series is deterministic (flat line at the anchor price) so SSR
// markup matches the client's first render. The random walk only starts
// after mount, so the chart starts moving on the first interval tick.
const INITIAL_PRICE = 3_842.55;
const INITIAL_ANCHOR = 3_820;
const SERIES_LEN = 22;

export function LogoCard() {
  const [price, setPrice] = useState(INITIAL_PRICE);
  const [series, setSeries] = useState<number[]>(() => Array(SERIES_LEN).fill(INITIAL_ANCHOR));

  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const next = last + (Math.random() - 0.5) * 8;
        setPrice(next);
        return [...prev.slice(1), next];
      });
    }, 1300);
    return () => clearInterval(id);
  }, []);

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(1, max - min);
  const w = 100;
  const h = 32;
  const sx = (i: number) => (i / (series.length - 1)) * w;
  const sy = (v: number) => h - 2 - ((v - min) / span) * (h - 6);
  const path = series.map((v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const positive = series[series.length - 1] >= series[0];
  const stroke = positive ? "#1ad094" : "#ff5a6a";
  const change = ((series[series.length - 1] - series[0]) / series[0]) * 100;

  return (
    <div className="spark-card spark-float-slow w-[180px] p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <div
            className="size-5 rounded-full flex items-center justify-center"
            style={{ background: "#627eea" }}
            aria-label="Ethereum"
          >
            <svg width="11" height="11" viewBox="0 0 32 32" aria-hidden>
              <path fill="#ffffff" d="M16 3l-9 14 9 5 9-5z" opacity="0.85" />
              <path fill="#ffffff" d="M16 3l-9 14 9-4z" />
              <path fill="#ffffff" d="M16 23.5l-9-5.5 9 12 9-12z" opacity="0.85" />
              <path fill="#ffffff" d="M16 23.5l-9-5.5 9 4z" />
            </svg>
          </div>
          <span className="text-[11px] font-medium text-[var(--s-text)]">ETH-PERP</span>
        </div>
        <span className="size-1.5 rounded-full bg-[#1ad094] pulse-dot" />
      </div>
      <div className="font-mono text-[18px] font-semibold tabular-nums text-[var(--s-text)] leading-none">
        ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="font-mono text-[11px]" style={{ color: stroke }}>
          {positive ? "+" : "−"}
          {Math.abs(change).toFixed(2)}%
        </span>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-[100px] h-[32px]" aria-hidden>
          <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

