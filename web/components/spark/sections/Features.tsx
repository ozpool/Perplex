interface Feature {
  title: string;
  body: string;
  icon: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: "Self-custody",
    body: "Your keys, your collateral. No custodian touches your USDC, ever.",
    icon: <KeyIcon />,
  },
  {
    title: "20× leverage",
    body: "Cross-margin across BTC, ETH, SOL. Capital-efficient by default.",
    icon: <ChartIcon />,
  },
  {
    title: "Sub-second fills",
    body: "EIP-712 signed orders match offchain, settle onchain in under a second.",
    icon: <BoltIcon />,
  },
  {
    title: "Session keys",
    body: "Sign once, trade for hours. No wallet popup per order. Revoke anytime.",
    icon: <SignIcon />,
  },
  {
    title: "50-level orderbook",
    body: "Real L2 depth. Group ticks, see cumulative size, click to set price.",
    icon: <BookIcon />,
  },
  {
    title: "No KYC",
    body: "Connect a wallet and trade. No emails, no accounts, no waiting lists.",
    icon: <LockIcon />,
  },
];

export function Features() {
  return (
    <section id="features" className="relative px-6 sm:px-10 lg:px-14 py-20 sm:py-28">
      <div className="max-w-screen-xl mx-auto">
        <h2 className="font-display text-[clamp(36px,5vw,68px)] leading-[0.95] tracking-[-0.03em] font-semibold text-[var(--s-text)] mb-4 max-w-[18ch]">
          One simple choice, <br />
          <span className="text-[var(--s-text-mid)]">Many perks.</span>
        </h2>
        <p className="text-[15px] sm:text-[16px] text-[var(--s-text-mid)] max-w-[52ch] mb-14 leading-relaxed">
          Built for traders who want centralised-exchange ergonomics without
          handing over their keys or their KYC.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="spark-card p-6 hover:shadow-[0_2px_0_rgba(15,8,52,0.04),0_18px_36px_-18px_rgba(15,8,52,0.32)] transition-shadow"
            >
              <div className="size-11 rounded-2xl bg-[var(--s-accent-tint)] text-[var(--s-accent-strong)] flex items-center justify-center mb-5">
                {f.icon}
              </div>
              <h3 className="font-display text-[20px] font-semibold text-[var(--s-text)] mb-2 tracking-[-0.02em]">
                {f.title}
              </h3>
              <p className="text-[14px] text-[var(--s-text-mid)] leading-relaxed">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function KeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 13L20 3.5M16 7l2 2M18 5l2 2" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l5-5 4 3 8-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 6h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}
function SignIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17c2-2 5-3 7-1s5 0 7-2 4-1 4-1" strokeLinecap="round" />
      <path d="M3 21h18" strokeLinecap="round" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h16M4 9h10M4 13h16M4 17h8" strokeLinecap="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}
