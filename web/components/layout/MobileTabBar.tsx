"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/store/ui-store";

const ITEMS = [
  { href: "/trade", label: "Trade", icon: ChartIcon, match: (p: string) => p.startsWith("/trade") || p === "/" },
  { href: "/markets", label: "Markets", icon: ListIcon, match: (p: string) => p === "/markets" },
  { href: "/portfolio", label: "Portfolio", icon: WalletIcon, match: (p: string) => p === "/portfolio" },
  { href: "/history", label: "History", icon: HistoryIcon, match: (p: string) => p === "/history" },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const selectedMarket = useUi((s) => s.selectedMarket);

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 h-[var(--mobile-tab-h)] border-t border-border bg-bg-1/95 backdrop-blur-md grid grid-cols-4"
      aria-label="Mobile primary"
    >
      {ITEMS.map((it) => {
        const Icon = it.icon;
        const active = it.match(pathname);
        const href = it.href === "/trade" ? `/trade/${selectedMarket}` : it.href;
        return (
          <Link
            key={it.href}
            href={href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 text-[10px]",
              active ? "text-accent" : "text-fg-muted"
            )}
          >
            <Icon active={active} />
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ChartIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l4-4 4 3 7-9" />
      <path d="M14 7h5v5" />
      {active && <circle cx="3" cy="17" r="1.5" fill="currentColor" />}
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M16 13h2" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v6l4 2" />
    </svg>
  );
}
