import Link from "next/link";

export function ContactFooter() {
  return (
    <section id="contact" className="relative px-6 sm:px-10 lg:px-14 pt-20 sm:pt-24 pb-10">
      <div className="max-w-screen-xl mx-auto">
        {/* Compact contact row */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-10 border-b border-[var(--s-line)]">
          <p className="inline-flex items-center gap-1.5 text-[14px] sm:text-[15px] text-[var(--s-text-mid)] leading-none">
            <span>Reach the team on</span>
            <Link
              href="https://github.com/ozpool/Perplex"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[var(--s-text)] hover:text-[var(--s-accent)] font-medium transition-colors"
            >
              <GitHubIcon />
              <span>GitHub.</span>
            </Link>
          </p>
        </div>

        {/* Big wordmark */}
        <h2 className="text-center mt-10">
          <Link
            href="/"
            aria-label="Perplex home"
            className="font-display font-bold tracking-[-0.05em] text-[var(--s-text)] leading-none inline-block hover:opacity-90 transition-opacity"
            style={{ fontSize: "clamp(80px, 18vw, 260px)" }}
          >
            perplex<span className="text-[var(--s-accent)]">.</span>
          </Link>
        </h2>

        <div className="mt-20 sm:mt-24 flex flex-col items-center gap-2 text-center text-[12px] text-[var(--s-text-soft)] font-mono">
          <span>© {new Date().getFullYear()} Perplex Labs. Trading derivatives carries substantial risk.</span>
          <span>v1.1.0 · arb-mainnet</span>
        </div>
      </div>
    </section>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="block">
      <path d="M12 1a11 11 0 00-3.5 21.4c.5.1.7-.3.7-.6v-2c-3 .6-3.8-1.4-3.8-1.4-.6-1.3-1.4-1.7-1.4-1.7-1.1-.7.1-.7.1-.7 1.3.1 2 1.3 2 1.3 1.1 1.9 3 1.4 3.8 1 .1-.8.5-1.4.8-1.7-2.5-.3-5-1.3-5-5.6 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 016 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3 0 4.3-2.5 5.3-5 5.6.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.7.6A11 11 0 0012 1z" />
    </svg>
  );
}
