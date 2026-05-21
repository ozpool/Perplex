import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Connect wallet",
    body: "MetaMask, Rabby, Coinbase, WalletConnect — any EVM wallet on Arbitrum. SIWE login, no email.",
  },
  {
    n: "02",
    title: "Sign + fill",
    body: "EIP-712 typed-data signature on every order. Match offchain in under 15ms, no wallet popup spam thanks to session keys.",
  },
  {
    n: "03",
    title: "Settle onchain",
    body: "Fills hit Arbitrum sub-second. Collateral, PnL, funding — all on the chain you can verify yourself.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      className="relative px-6 sm:px-10 lg:px-14 py-20 sm:py-28 bg-[var(--s-bg-soft)]"
    >
      <div className="max-w-screen-xl mx-auto">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-14">
          <h2 className="font-display text-[clamp(36px,5vw,68px)] leading-[0.95] tracking-[-0.03em] font-semibold text-[var(--s-text)] max-w-[14ch]">
            How it <span className="inline-flex items-center justify-center bg-[var(--s-accent)] text-white px-6 pt-[0.05em] pb-[0.18em] rounded-full font-display tracking-[-0.02em] leading-[1] align-middle">works</span>
          </h2>
          <p className="text-[15px] sm:text-[16px] text-[var(--s-text-mid)] max-w-[40ch] leading-relaxed">
            Three steps. No bridges, no waiting queues, no custodial holds.
          </p>
        </div>

        <ol className="grid md:grid-cols-3 gap-4">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className="spark-card p-7 flex flex-col gap-4 relative overflow-hidden"
            >
              <span className="font-mono text-[12px] tracking-[0.2em] text-[var(--s-accent-strong)] uppercase">
                Step {s.n}
              </span>
              <h3 className="font-display text-[26px] sm:text-[30px] font-semibold tracking-[-0.02em] text-[var(--s-text)]">
                {s.title}
              </h3>
              <p className="text-[14px] text-[var(--s-text-mid)] leading-relaxed">{s.body}</p>
              <span
                aria-hidden
                className={
                  "absolute -bottom-6 font-display text-[120px] font-bold text-[var(--s-accent-tint)] leading-none select-none " +
                  (i === 0 ? "right-2" : "-right-6")
                }
              >
                {i + 1}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex justify-center">
          <Link
            href="/docs#intro"
            className="group inline-flex items-center gap-2.5 h-11 pl-5 pr-4 rounded-full bg-[var(--s-bg)] border border-[var(--s-line)] font-display font-semibold tracking-[-0.01em] text-[14px] text-[var(--s-text)] hover:border-[var(--s-accent)] hover:text-[var(--s-accent)] transition-colors"
          >
            Read the full walkthrough in the docs
            <span className="inline-flex items-center justify-center size-7 rounded-full bg-[var(--s-accent)] text-white transition-transform group-hover:translate-x-0.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
