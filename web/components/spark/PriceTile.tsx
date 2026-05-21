"use client";
import { useEffect, useState } from "react";

// Floating tile showing live-ish BTC price + tiny sparkline.
// Replaces the "person photo" card from the Spark reference.
export function PriceTile() {
  const [price, setPrice] = useState(100_124.36);
  const [series, setSeries] = useState<number[]>(() => seed(100_000, 22));

  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const next = last + (Math.random() - 0.5) * 60;
        setPrice(next);
        return [...prev.slice(1), next];
      });
    }, 1100);
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
    <div className="spark-card spark-float-fast w-[180px] p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <div
            className="size-5 rounded-full flex items-center justify-center"
            style={{ background: "#f7931a" }}
            aria-label="Bitcoin"
          >
            <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
              <path
                fill="#ffffff"
                d="M21.66 14.36c.34-2.27-1.39-3.49-3.76-4.31l.77-3.09-1.88-.47-.75 3.01c-.49-.12-1-.24-1.5-.35l.75-3.03-1.88-.47-.77 3.09c-.41-.09-.81-.18-1.2-.28v-.01l-2.6-.65-.5 2.01s1.4.32 1.37.34c.76.19.9.7.88 1.1l-.88 3.52c.05.01.12.03.2.06l-.2-.05-1.23 4.93c-.09.23-.33.58-.86.45.02.03-1.37-.34-1.37-.34l-.93 2.15 2.45.61c.46.11.9.23 1.34.34l-.78 3.13 1.88.47.77-3.09c.51.14 1.01.26 1.5.38l-.77 3.07 1.88.47.78-3.12c3.21.61 5.62.36 6.64-2.55.82-2.34-.04-3.69-1.73-4.57 1.23-.28 2.16-1.09 2.41-2.77zm-4.31 6.04c-.58 2.34-4.52 1.07-5.8.75l1.03-4.14c1.28.32 5.38.95 4.77 3.39zm.59-6.08c-.53 2.13-3.81 1.05-4.87.78l.94-3.75c1.07.27 4.49.77 3.93 2.97z"
              />
            </svg>
          </div>
          <span className="text-[11px] font-medium text-[var(--s-text)]">BTC-PERP</span>
        </div>
        <span className="size-1.5 rounded-full bg-[#1ad094] pulse-dot" />
      </div>
      <div className="font-mono text-[18px] font-semibold tabular-nums text-[var(--s-text)] leading-none">
        ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`font-mono text-[11px]`} style={{ color: stroke }}>
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

function seed(anchor: number, n: number): number[] {
  const out: number[] = [];
  let v = anchor;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * 90;
    out.push(v);
  }
  return out;
}
