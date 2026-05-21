"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { useUi } from "@/lib/store/ui-store";

const NAV = [
  { href: "/trade", label: "Trade", match: (p: string) => p.startsWith("/trade") || p === "/" },
  { href: "/markets", label: "Markets", match: (p: string) => p === "/markets" },
  { href: "/portfolio", label: "Portfolio", match: (p: string) => p === "/portfolio" },
  { href: "/history", label: "History", match: (p: string) => p === "/history" },
  { href: "/wallet", label: "Wallet", match: (p: string) => p === "/wallet" },
];

export function TopNav() {
  const pathname = usePathname();
  const selectedMarket = useUi((s) => s.selectedMarket);

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{ background: "color-mix(in oklab, var(--bg-0) 84%, transparent)" }}
    >
      <div
        className="border-b border-border flex items-center gap-4 px-3 sm:px-5 h-[var(--topbar-h)]"
      >
        <Link href={`/trade/${selectedMarket}`} className="flex items-center gap-2 shrink-0">
          <Logo />
        </Link>
        <nav className="hidden md:flex items-center gap-1 ml-2" aria-label="Primary">
          {NAV.map((n) => {
            const active = n.match(pathname);
            const href = n.href === "/trade" ? `/trade/${selectedMarket}` : n.href;
            return (
              <Link
                key={n.href}
                href={href}
                className={cn(
                  "px-3 h-9 inline-flex items-center text-[13px] rounded-[var(--radius-sm)] transition-colors",
                  active
                    ? "text-fg bg-bg-2"
                    : "text-fg-muted hover:text-fg hover:bg-bg-2"
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <WalletButton />
      </div>
    </header>
  );
}
