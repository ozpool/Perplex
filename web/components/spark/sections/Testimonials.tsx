interface Quote {
  body: string;
  name: string;
  handle: string;
  avatarColor: string;
  initials: string;
}

const QUOTES: Quote[] = [
  {
    body: "Finally a DEX that feels like a real exchange. Order form, books, fills — all snappy. Custody never left my wallet.",
    name: "Jules Park",
    handle: "Quant trader",
    avatarColor: "#ff6b1a",
    initials: "JP",
  },
  {
    body: "Self-custody perps without the usual jank. No bridges, no funding queues, no 'pending withdrawal' purgatory. Just trades.",
    name: "Mira Okafor",
    handle: "DeFi researcher",
    avatarColor: "#d9531d",
    initials: "MO",
  },
  {
    body: "Fastest fills I've seen outside of a CEX. Session keys saved my mouse hand — no popup every five seconds.",
    name: "Ravi Iyer",
    handle: "Market maker",
    avatarColor: "#8b3a14",
    initials: "RI",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="relative px-6 sm:px-10 lg:px-14 py-20 sm:py-28">
      <div className="max-w-screen-xl mx-auto">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-14">
          <h2 className="font-display text-[clamp(36px,5vw,68px)] leading-[0.95] tracking-[-0.03em] font-semibold text-[var(--s-text)] max-w-[16ch]">
            Traders who <br />
            <span className="text-[var(--s-text-mid)]">already shipped.</span>
          </h2>
          <p className="text-[15px] sm:text-[16px] text-[var(--s-text-mid)] max-w-[40ch] leading-relaxed">
            What people who actually trade on Perplex have to say.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {QUOTES.map((q) => (
            <figure
              key={q.name}
              className="spark-card p-7 flex flex-col gap-6"
            >
              <Quotes />
              <blockquote className="text-[15px] text-[var(--s-text)] leading-[1.55] flex-1">
                {q.body}
              </blockquote>
              <figcaption className="flex items-center gap-3">
                <div
                  className="size-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold"
                  style={{ background: q.avatarColor }}
                >
                  {q.initials}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[14px] font-medium text-[var(--s-text)]">{q.name}</span>
                  <span className="text-[12px] text-[var(--s-text-soft)]">{q.handle}</span>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Quotes() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="var(--s-accent)" aria-hidden>
      <path d="M0 22V12C0 5.4 4.4 0.8 11 0v4.4C7.6 5 5.6 7.4 5.4 11H11v11H0zm17 0V12c0-6.6 4.4-11.2 11-12v4.4C24.6 5 22.6 7.4 22.4 11H28v11H17z" />
    </svg>
  );
}
