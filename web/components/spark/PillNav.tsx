"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { PerplexMark } from "./PerplexMark";

const NAV = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how" },
  { label: "Docs", href: "/docs" },
  { label: "Stats", href: "/#stats" },
  { label: "Contact", href: "/#contact" },
];

export function PillNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";
  const showNav = pathname === "/";
  return (
    <header className="relative z-20">
      <div className="flex items-center justify-between gap-4 px-6 sm:px-10 lg:px-14 py-6 sm:py-7">
        <Link href="/" className="flex items-center gap-2 shrink-0 text-[var(--s-text)]" aria-label="Perplex home">
          <PerplexMark size={30} />
          <span className="font-display text-[22px] font-semibold tracking-[-0.04em]">
            perplex<span className="text-[var(--s-accent)]">.</span>
          </span>
        </Link>

        {showNav && (
          <nav className="hidden md:flex items-center" aria-label="Primary">
            <ul className="flex items-center bg-[var(--s-card)] rounded-full px-2 h-12 shadow-[0_1px_0_rgba(15,8,52,0.04),0_4px_18px_-10px_rgba(15,8,52,0.22)]">
              {NAV.map((n) => (
                <li key={n.label}>
                  <a
                    href={n.href}
                    className="px-4 h-9 inline-flex items-center text-[14px] text-[var(--s-text)] hover:text-[var(--s-accent)] transition-colors rounded-full"
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="hidden sm:flex items-center gap-2">
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-[var(--s-card)] border border-[var(--s-line)] text-[14px] text-[var(--s-text)] font-medium hover:text-[var(--s-accent)] transition-colors shadow-[0_1px_0_rgba(15,8,52,0.04),0_4px_18px_-10px_rgba(15,8,52,0.22)]"
          >
            Get Started
          </Link>

          <Link
            href="https://github.com/ozpool/Perplex"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="inline-flex items-center justify-center size-12 rounded-full bg-[var(--s-card)] border border-[var(--s-line)] text-[var(--s-text)] hover:text-[var(--s-accent)] transition-colors shadow-[0_1px_0_rgba(15,8,52,0.04),0_4px_18px_-10px_rgba(15,8,52,0.22)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
              />
            </svg>
          </Link>
        </div>

        <button
          aria-label="Open menu"
          onClick={() => setOpen((o) => !o)}
          className="md:hidden inline-flex items-center justify-center size-11 rounded-full bg-[var(--s-card)] border border-[var(--s-line)] text-[var(--s-text)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden absolute left-4 right-4 top-[88px] z-30 bg-[var(--s-card)] rounded-2xl border border-[var(--s-line)] p-3 shadow-[0_24px_48px_-24px_rgba(15,8,52,0.4)]">
          <ul className="flex flex-col">
            {showNav && NAV.map((n) => (
              <li key={n.label}>
                <a
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 h-11 inline-flex items-center text-[15px] text-[var(--s-text)]"
                >
                  {n.label}
                </a>
              </li>
            ))}
            <li className="pt-2 mt-2 border-t border-[var(--s-line)]">
              <Link
                href="/markets"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center h-11 w-full rounded-full bg-[var(--s-text)] text-white text-[14px] font-medium"
              >
                Get Started
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
