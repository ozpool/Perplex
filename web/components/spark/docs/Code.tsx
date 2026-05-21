"use client";
import { useState } from "react";

interface Props {
  language?: string;
  children: string;
}

export function Code({ language = "json", children }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] overflow-hidden my-3 shadow-[0_1px_0_rgba(15,8,52,0.04),0_8px_24px_-14px_rgba(15,8,52,0.25)]">
      <div className="flex items-center justify-between pl-4 pr-2 h-9 bg-[#0c0530] text-white">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#ff6b6b]" />
          <span className="size-2 rounded-full bg-[#ffd76e]" />
          <span className="size-2 rounded-full bg-[#5fd7d3]" />
          <span className="ml-3 text-[10px] font-mono uppercase tracking-[0.18em] text-white/55">
            {language}
          </span>
        </div>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-mono uppercase tracking-[0.15em] text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          {copied ? (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Copied
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/></svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        className="px-5 py-4 overflow-x-auto text-[12.5px] leading-[1.65] font-mono tabular-nums"
        style={{ background: "#14102e", color: "#e6e4f5" }}
      >
        <code
          style={{
            background: "transparent",
            color: "inherit",
            padding: 0,
            borderRadius: 0,
            fontSize: "inherit",
          }}
        >
          {children}
        </code>
      </pre>
    </div>
  );
}
