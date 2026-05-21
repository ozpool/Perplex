import Link from "next/link";
import { RingBg } from "./RingBg";
import { LogoCard } from "./LogoCard";
import { PriceTile } from "./PriceTile";

export function Hero() {
  return (
    <section className="relative pb-14 sm:pb-20">
      <RingBg />

      <div className="relative max-w-screen-xl mx-auto px-6 sm:px-10 lg:px-14 pt-6 sm:pt-10 lg:pt-14">
        {/* Eyebrow */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-[var(--s-line)] bg-white/60 backdrop-blur text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--s-text-mid)]">
            <span className="size-1.5 rounded-full bg-[var(--s-accent)] pulse-dot" />
            Arbitrum · Non-Custodial · Live
          </span>
        </div>

        {/* Headline — stacked, periods aligned on the right */}
        <h1 className="font-display mt-6 font-semibold text-[var(--s-text)] leading-[0.92] tracking-[-0.04em] text-center">
          <span className="inline-block text-right">
            <span className="block text-[clamp(52px,8.5vw,124px)]">Signed. Settled.</span>
            <span className="block text-[clamp(52px,8.5vw,124px)] text-[var(--s-accent)]">
              Sovereign.
            </span>
          </span>
        </h1>

        {/* Centre band with floating cards on each side */}
        <div className="relative mt-10 sm:mt-12 min-h-[200px] sm:min-h-[280px]">
          <div className="absolute left-[4%] top-[38%] hidden sm:block">
            <LogoCard />
          </div>

          <div className="absolute right-[8%] top-[10%] hidden sm:block">
            <PriceTile />
          </div>

          <div className="sm:hidden flex justify-center gap-4">
            <LogoCard />
            <PriceTile />
          </div>
        </div>

        {/* Bottom block: right side, content left-aligned within */}
        <div className="relative mt-12 sm:mt-2 flex justify-end">
          <div className="flex flex-col items-start gap-5 max-w-[34ch]">
            <p className="font-display font-semibold tracking-[-0.01em] text-[14px] sm:text-[15px] text-[var(--s-text)] leading-relaxed text-left">
              Up to 20× leverage on BTC, ETH, SOL.
              EIP-712 signed orders. Sub-second
              settlement on Arbitrum. Self-custody,
              no KYC.
            </p>
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 h-12 pl-3 pr-5 rounded-full bg-[var(--s-accent-soft)] hover:bg-[var(--s-accent)] hover:text-white text-[var(--s-text)] text-[14px] font-semibold transition-colors shadow-[0_2px_6px_rgba(255,107,26,0.22),0_12px_28px_-12px_rgba(255,107,26,0.55)]"
            >
              <span className="inline-flex items-center justify-center size-8 rounded-full bg-white/70">
                <PlayIcon />
              </span>
              Get Started
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="#0c0530" aria-hidden>
      <path d="M3 1.6v8.8L10 6z" />
    </svg>
  );
}
