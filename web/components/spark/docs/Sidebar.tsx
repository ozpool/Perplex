"use client";

import { useEffect, useState } from "react";

interface Item {
  id: string;
  label: string;
}
interface Group {
  title: string;
  icon: React.ReactNode;
  items: Item[];
}

const GROUPS: Group[] = [
  {
    title: "Getting started",
    icon: <PlayIcon />,
    items: [
      { id: "intro", label: "Introduction" },
      { id: "quickstart", label: "Quickstart" },
      { id: "deposit", label: "Deposit USDC" },
    ],
  },
  {
    title: "Concepts",
    icon: <BookIcon />,
    items: [
      { id: "what-is-perp", label: "What is a perpetual?" },
      { id: "margin", label: "Margin & leverage" },
      { id: "funding", label: "Funding rates" },
      { id: "liquidation", label: "Liquidation" },
    ],
  },
  {
    title: "Trading",
    icon: <ChartIcon />,
    items: [
      { id: "order-types", label: "Order types" },
      { id: "tif", label: "Time in force" },
      { id: "session-keys", label: "Session keys" },
      { id: "eip712", label: "EIP-712 orders" },
      { id: "fees", label: "Fees" },
    ],
  },
  {
    title: "Tutorials",
    icon: <CompassIcon />,
    items: [
      { id: "tut-first-long", label: "Open your first long" },
      { id: "tut-limit", label: "Place a limit order" },
      { id: "tut-session", label: "Approve a session key" },
      { id: "tut-close", label: "Close a position" },
    ],
  },
  {
    title: "Developers",
    icon: <CodeIcon />,
    items: [
      { id: "api-rest", label: "REST API" },
      { id: "api-ws", label: "WebSocket channels" },
    ],
  },
  {
    title: "Other",
    icon: <HelpIcon />,
    items: [
      { id: "faq", label: "FAQ" },
      { id: "risk", label: "Risk disclosure" },
    ],
  },
];

export function Sidebar() {
  const [active, setActive] = useState<string>("intro");

  useEffect(() => {
    const ids = GROUPS.flatMap((g) => g.items.map((i) => i.id));
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-100px 0px -70% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <nav
      aria-label="Documentation"
      className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto overflow-x-hidden pr-2 pb-16"
    >
      <ul className="flex flex-col gap-7 text-[13px]">
        {GROUPS.map((g) => (
          <li key={g.title}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="inline-flex items-center justify-center size-5 rounded-[var(--radius-xs)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                {g.icon}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--fg-muted)]">
                {g.title}
              </span>
            </div>
            <ul className="flex flex-col">
              {g.items.map((it) => (
                <li key={it.id}>
                  <a
                    href={`#${it.id}`}
                    className={
                      "block py-2 px-3 transition-colors " +
                      (active === it.id
                        ? "bg-[var(--accent-soft)] text-[var(--fg)] font-semibold rounded-[10px]"
                        : "border-l border-[var(--border)] -ml-px text-[var(--fg-mid)] hover:text-[var(--fg)] hover:border-[var(--border-strong)]")
                    }
                  >
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PlayIcon() {
  return <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.6v8.8L10 6z" /></svg>;
}
function BookIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 5h16M4 9h10M4 13h16M4 17h8" /></svg>;
}
function ChartIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M3 17l5-5 4 3 8-9" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 6h6v6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function CompassIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M16 8l-2.5 5.5L8 16l2.5-5.5z" strokeLinejoin="round" fill="currentColor"/></svg>;
}
function CodeIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function HelpIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 16h.01" strokeLinecap="round"/></svg>;
}
