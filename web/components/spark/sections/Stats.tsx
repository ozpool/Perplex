"use client";
import { useEffect, useState } from "react";

const BARS = [
  { label: "Mon", h: 38 },
  { label: "Tue", h: 52 },
  { label: "Wed", h: 44 },
  { label: "Thu", h: 70 },
  { label: "Fri", h: 86 },
  { label: "Sat", h: 64 },
  { label: "Sun", h: 92 },
];

export function Stats() {
  const [vol, setVol] = useState(2.42);
  const [oi, setOi] = useState(891.4);
  const [fills, setFills] = useState(184_320_000);

  useEffect(() => {
    const id = setInterval(() => {
      setVol((v) => v + Math.random() * 0.002);
      setOi((v) => v + Math.random() * 0.04);
      setFills((v) => v + Math.floor(Math.random() * 80));
    }, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      id="stats"
      className="relative px-6 sm:px-10 lg:px-14 py-20 sm:py-28 bg-[var(--s-bg-soft)]"
    >
      <div className="max-w-screen-xl mx-auto">
        <h2 className="font-display text-center text-[clamp(36px,5vw,68px)] leading-[0.95] tracking-[-0.03em] font-semibold text-[var(--s-text)] mb-14">
          The benefits, by the numbers.
        </h2>

        <div className="grid md:grid-cols-[1fr_1fr_1.6fr] gap-4">
          <div className="spark-card p-6 flex flex-col justify-between min-h-[220px]">
            <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--s-text-soft)]">
              24h volume
            </div>
            <div>
              <div className="font-display font-semibold text-[clamp(40px,5vw,64px)] leading-none tracking-[-0.03em] text-[var(--s-text)] tabular-nums">
                ${vol.toFixed(2)}<span className="text-[var(--s-accent)]">B</span>
              </div>
              <div className="mt-2 text-[12px] font-mono text-[var(--s-accent-strong)]">+4.8% vs 7d avg</div>
            </div>
          </div>

          <div className="spark-card p-6 flex flex-col justify-between min-h-[220px]">
            <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--s-text-soft)]">
              Open interest
            </div>
            <div>
              <div className="font-display font-semibold text-[clamp(40px,5vw,64px)] leading-none tracking-[-0.03em] text-[var(--s-text)] tabular-nums">
                ${oi.toFixed(1)}<span className="text-[var(--s-accent)]">M</span>
              </div>
              <div className="mt-2 text-[12px] font-mono text-[var(--s-text-soft)]">across 3 markets</div>
            </div>
          </div>

          <div className="spark-card p-6 flex flex-col gap-5 min-h-[220px]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--s-text-soft)]">
                  Weekly fills
                </div>
                <div className="mt-1 font-display font-semibold text-[clamp(28px,3vw,40px)] leading-none tracking-[-0.02em] text-[var(--s-text)] tabular-nums">
                  {fills.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-[var(--s-accent-tint)] text-[var(--s-accent-strong)] text-[11px] font-semibold uppercase tracking-[0.12em]">
                <span className="size-1.5 rounded-full bg-[var(--s-accent)] pulse-dot" />
                Live
              </span>
            </div>
            <div className="flex items-end justify-between gap-3 flex-1">
              {BARS.map((b) => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md"
                    style={{
                      height: `${b.h}%`,
                      background: `linear-gradient(180deg, var(--s-accent) 0%, var(--s-accent-strong) 100%)`,
                    }}
                  />
                  <span className="text-[10px] font-mono text-[var(--s-text-soft)]">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <KvCard label="Avg fill latency" value="<15ms" />
          <KvCard label="Max leverage" value="20×" />
          <KvCard label="Settlement" value="Arbitrum L2" />
        </div>
      </div>
    </section>
  );
}

function KvCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="spark-card p-5 flex items-center justify-between">
      <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-[var(--s-text-soft)]">
        {label}
      </span>
      <span className="font-display text-[22px] font-semibold text-[var(--s-text)] tracking-[-0.02em]">
        {value}
      </span>
    </div>
  );
}
