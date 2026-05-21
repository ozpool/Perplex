import Link from "next/link";
import { Sidebar } from "@/components/spark/docs/Sidebar";
import { Section } from "@/components/spark/docs/Section";
import { Callout } from "@/components/spark/docs/Callout";
import { Code } from "@/components/spark/docs/Code";
import { Steps } from "@/components/spark/docs/Steps";
import { FAQ } from "@/components/spark/docs/FAQ";
import { MarginDiagram, FundingDiagram, LiqDiagram } from "@/components/spark/docs/Diagram";

export default function DocsPage() {
  return (
    <section className="relative px-6 sm:px-10 lg:px-14 pt-10 sm:pt-16 pb-20">
      {/* Background flair — two orange orbs and faint dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full blur-[140px] opacity-30"
        style={{ background: "radial-gradient(circle, rgba(255,107,26,0.35) 0%, transparent 60%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-40 right-[-200px] w-[600px] h-[600px] rounded-full blur-[140px] opacity-25"
        style={{ background: "radial-gradient(circle, rgba(94,53,177,0.3) 0%, transparent 65%)" }}
      />

      <div className="relative max-w-screen-xl mx-auto">
        {/* HERO */}
        <header className="mb-14">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] gap-10 lg:gap-14 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-[var(--border-strong)] bg-[var(--bg-1)] text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--accent-strong)]">
                  <span className="size-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
                  Docs · v1.1
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 h-7 rounded-full bg-[var(--bg-1)] border border-[var(--border)] text-[11px] font-mono text-[var(--fg-mid)]">
                  <ClockIcon />
                  ~12 min read
                </span>
                <a
                  href="https://github.com/ozpool/Perplex"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 h-7 rounded-full bg-[var(--bg-1)] border border-[var(--border)] text-[11px] font-mono text-[var(--fg-mid)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                >
                  <GitHubIcon />
                  Edit on GitHub
                </a>
              </div>

              <h1 className="font-display text-[clamp(44px,6vw,84px)] font-semibold tracking-[-0.035em] text-[var(--fg)] leading-[0.96] max-w-[18ch]">
                Everything you need to{" "}
                <span className="text-[var(--accent)]">trade Perplex.</span>
              </h1>
              <p className="text-[16px] sm:text-[18px] text-[var(--fg-mid)] mt-6 leading-relaxed max-w-[60ch]">
                Concepts, order mechanics, signed messages, API surface, and step-by-step tutorials.
                Start at the top or jump to a topic.
              </p>
            </div>

            <ApiPreview />
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-10">
            <StatCard label="Sections" value="17" />
            <StatCard label="Concepts" value="4" />
            <StatCard label="Tutorials" value="4" />
            <StatCard label="API endpoints" value="10+" />
          </div>
        </header>

        <div className="grid lg:grid-cols-[240px_minmax(0,1fr)] gap-10 lg:gap-16">
          <Sidebar />

          <article className="min-w-0">
            {/* ── Getting started ─────────────────────────────────────────── */}
            <Section id="intro" eyebrow="Getting started" title="Introduction" icon={<PlayIcon />}>
              <p>
                Perplex is a non-custodial perpetual futures exchange. You trade BTC, ETH and SOL
                perps with up to 20× cross-margin leverage, your collateral never leaves your wallet
                until you sign an order, and every fill settles onchain on Arbitrum.
              </p>
              <p>
                The frontend you are reading these docs from is one of many possible deployments of
                the open Perplex protocol. The protocol is governed by a smart-contract Settlement
                Engine on Arbitrum and a public REST + WebSocket API spec defined in{" "}
                <code>api-contract.md</code>.
              </p>
            </Section>

            <Section id="quickstart" eyebrow="Getting started" title="Quickstart" icon={<BoltIcon />}>
              <p>From zero to your first trade in four steps.</p>
              <Steps
                steps={[
                  { title: "Connect a wallet", body: <>MetaMask, Rabby, Coinbase Wallet, or any WalletConnect-compatible wallet on Arbitrum.</> },
                  { title: "Sign in with Ethereum", body: <>Perplex uses SIWE for session auth. One signature, no email, no password.</> },
                  { title: "Deposit USDC", body: <>Open the <Link href="/wallet">Wallet</Link> tab and transfer USDC from your wallet to the trading vault.</> },
                  { title: "Place an order", body: <>Head to <Link href="/trade/btc-usd">Trade</Link>, pick Long or Short, set size + leverage, hit the button. Sign the EIP-712 prompt, fill acks in &lt;15ms.</> },
                ]}
              />
            </Section>

            <Section id="deposit" eyebrow="Getting started" title="Deposit USDC" icon={<CoinIcon />}>
              <p>
                Your trading vault is a smart-contract balance bound to your wallet address. To
                deposit, approve USDC spending and call <code>vault.deposit(amount)</code>. The
                Wallet UI does this for you.
              </p>
              <Callout kind="info">
                Deposits become tradeable on the next block (~250ms on Arbitrum). Withdrawals are
                instant onchain — no waiting queue, no bridge, no operator approval.
              </Callout>
            </Section>

            {/* ── Concepts ────────────────────────────────────────────────── */}
            <Section id="what-is-perp" eyebrow="Concepts" title="What is a perpetual?" icon={<InfinityIcon />}>
              <p>
                A perpetual future (perp) is a leveraged derivative that tracks the spot price of an
                asset and never expires. Unlike a dated future, there is no settlement date —
                instead, a continuous <strong>funding rate</strong> nudges the perp price back toward
                the underlying index by periodically transferring USDC between longs and shorts.
              </p>
              <p>
                On Perplex, every market is quoted in USD and collateralised in USDC. Going{" "}
                <strong>long</strong> profits when the index rises; going <strong>short</strong>{" "}
                profits when it falls. Leverage multiplies both.
              </p>
            </Section>

            <Section id="margin" eyebrow="Concepts" title="Margin & leverage" icon={<ShieldIcon />}>
              <p>
                Perplex uses <strong>cross-margin</strong>: one USDC collateral pool backs every open
                position. Unrealised PnL counts as margin in real time, so winners free up capital
                and losers consume it.
              </p>
              <MarginDiagram />
              <p>Each market has two key ratios:</p>
              <ul>
                <li><strong>Initial Margin (IM)</strong> — collateral required to open. Default 5% (20× max leverage).</li>
                <li><strong>Maintenance Margin (MM)</strong> — collateral required to stay open. Default 2.5%. Drop below MM → liquidation.</li>
              </ul>
              <Code language="formula">{`liquidationPrice = entryPrice × (1 − 1/leverage + MM)   for longs
liquidationPrice = entryPrice × (1 + 1/leverage − MM)   for shorts`}</Code>
              <p>The order form previews your liquidation price before you sign. Always check it.</p>
            </Section>

            <Section id="funding" eyebrow="Concepts" title="Funding rates" icon={<RefreshIcon />}>
              <p>
                Funding is the mechanism that ties perpetual prices to the index. It settles every
                8 hours.
              </p>
              <FundingDiagram />
              <ul>
                <li><strong>Positive funding</strong> — perp trading above index. Longs pay shorts.</li>
                <li><strong>Negative funding</strong> — perp trading below index. Shorts pay longs.</li>
              </ul>
              <Code language="formula">{`fundingAmount = positionNotional × fundingRate × (intervalSec / yearSec)`}</Code>
              <p>
                Current funding rate + countdown to next settlement is in the market header on the
                Trade screen. Historical funding is available via <code>/v1/funding/{`{marketId}`}</code>.
              </p>
            </Section>

            <Section id="liquidation" eyebrow="Concepts" title="Liquidation" icon={<WarnIcon />}>
              <p>
                A position is liquidated when its collateral falls below the Maintenance Margin
                threshold. Liquidations are handled by the Settlement Engine — no manual keeper rent.
              </p>
              <LiqDiagram />
              <p>
                When liquidated, your position is closed at the oracle price minus a{" "}
                <strong>liquidation bonus</strong> (default 1%), paid to the insurance fund. The rest
                of your collateral is preserved.
              </p>
              <Callout kind="warn">
                Watch <strong>free collateral</strong> on the Trade screen. The WS account stream
                emits a <code>liquidation.warning</code> when your health factor drops below 1.05.
              </Callout>
            </Section>

            {/* ── Trading ────────────────────────────────────────────────── */}
            <Section id="order-types" eyebrow="Trading" title="Order types" icon={<OrderIcon />}>
              <p>Perplex supports two order types and three modifiers.</p>

              <div className="grid sm:grid-cols-2 gap-3 my-2">
                <OrderTypeCard
                  name="Market"
                  role="Taker"
                  tone="warm"
                  body="Fills immediately against the best opposing levels in the book. No price guarantee — you get what's available."
                  bullets={["Instant execution", "Always crosses spread", "Pays taker fee"]}
                  icon={<BoltIcon />}
                />
                <OrderTypeCard
                  name="Limit"
                  role="Maker / Taker"
                  tone="cool"
                  body="Rests on the book at your price. Becomes a taker if it crosses, otherwise sits and waits as a maker."
                  bullets={["Price guarantee", "Can earn maker rebate", "Sits until filled or cancelled"]}
                  icon={<TargetIcon />}
                />
              </div>

              <p className="!mt-6">Limit orders accept three modifiers:</p>

              <div className="grid sm:grid-cols-3 gap-3 my-2">
                <ModifierCard
                  name="Post-only"
                  body="Reject if the order would cross the spread. Guarantees maker status and the maker rebate."
                  icon={<PinIcon />}
                />
                <ModifierCard
                  name="Reduce-only"
                  body="Only allow this order to decrease your position size. Useful for stop-losses and take-profits."
                  icon={<ShieldIcon />}
                />
                <ModifierCard
                  name="Time-in-force"
                  body="Pick GTC, IOC or FOK to control how aggressively the order tries to fill. See next section."
                  icon={<ClockIcon />}
                />
              </div>
            </Section>

            <Section id="tif" eyebrow="Trading" title="Time in force" icon={<ClockIcon />}>
              <div className="grid sm:grid-cols-3 gap-3 my-2">
                <TifCard tag="GTC" name="Good-Til-Cancelled" body="Order rests until filled or you cancel." />
                <TifCard tag="IOC" name="Immediate-Or-Cancel" body="Fill what you can right now, cancel the rest." />
                <TifCard tag="FOK" name="Fill-Or-Kill" body="Fill the entire size now, or cancel the whole order." />
              </div>
            </Section>

            <Section id="session-keys" eyebrow="Trading" title="Session keys" icon={<KeyIcon />}>
              <p>
                Signing every order with your main wallet would mean a popup every few seconds.
                Session keys solve this.
              </p>
              <p>
                You sign <strong>one</strong> SessionKey approval. The approval creates an
                in-browser keypair bounded by:
              </p>
              <ul>
                <li><strong>Expiry</strong> — wall-clock seconds (default 4h).</li>
                <li><strong>Max notional</strong> — cap on total USDC notional that can be opened.</li>
                <li><strong>Allowed markets</strong> — array of market IDs this session can trade.</li>
              </ul>
              <p>
                The session private key lives in IndexedDB, encrypted with a passphrase if you set
                one. Every subsequent order is signed by the session key, never your wallet. Revoke
                any time from <Link href="/wallet">Wallet → Sessions</Link>.
              </p>
              <Callout kind="tip">
                For read-only sessions, set max notional to 0 and only allow query endpoints.
              </Callout>
            </Section>

            <Section id="eip712" eyebrow="Trading" title="EIP-712 signed orders" icon={<SignIcon />}>
              <p>
                Every Perplex order is an EIP-712 typed-data signature over the Order struct. The
                hash is what the Settlement Engine verifies onchain.
              </p>
              <Code language="solidity">{`struct Order {
  address owner;
  bytes32 marketId;     // keccak256(market id, e.g. "btc-usd")
  uint8   side;         // 0 = buy, 1 = sell
  uint8   orderType;    // 0 = market, 1 = limit
  uint256 price;        // 1e18-scaled
  uint256 qty;          // 1e18-scaled
  uint8   timeInForce;  // 0 = gtc, 1 = ioc, 2 = fok
  bool    reduceOnly;
  bool    postOnly;
  uint256 nonce;        // ns timestamp
  uint64  expiryTsSec;  // 0 = no expiry
}`}</Code>
              <p>
                Domain separator: <code>name=&quot;Perplex&quot;</code>, <code>version=&quot;1&quot;</code>,{" "}
                <code>chainId</code>, <code>verifyingContract=SettlementEngine</code>.
              </p>
            </Section>

            <Section id="fees" eyebrow="Trading" title="Fees" icon={<CoinIcon />}>
              <div className="grid sm:grid-cols-2 gap-3 my-2">
                <FeeCard label="Taker" value="5 bps" note="0.05% of fill notional" tone="warm" />
                <FeeCard label="Maker rebate" value="−2 bps" note="0.02% credited at fill" tone="cool" />
                <FeeCard label="Gas" value="$0" note="Deployer pays. Trading is gas-free." tone="cool" />
                <FeeCard label="Withdrawal" value="~$0.10" note="One Arbitrum tx in ETH" tone="warm" />
              </div>
              <p>No volume tiers, no subscription, no referral cuts. Same fees for everyone.</p>
            </Section>

            {/* ── Tutorials ─────────────────────────────────────────────── */}
            <Section id="tut-first-long" eyebrow="Tutorials" title="Open your first long" icon={<RocketIcon />}>
              <Steps
                steps={[
                  { title: "Open BTC-PERP", body: <>Head to the <Link href="/trade/btc-usd">BTC-PERP trade page</Link>.</> },
                  { title: "Select Long", body: <>In the order form, ensure <strong>Long</strong> is selected.</> },
                  { title: "Switch to Market", body: <>Tab over to <strong>Market</strong> for an immediate fill.</> },
                  { title: "Enter size", body: <>Type a size in BTC (e.g. <code>0.01</code>). The form previews margin required, fee, and liq price.</> },
                  { title: "Set leverage", body: <>Drag the leverage slider — start with 2× until comfortable.</> },
                  { title: "Sign", body: <>Click <strong>Long BTC</strong>. Wallet asks to sign the EIP-712 Order. The order shows <code>syncing…</code> for ~50ms then drops into <strong>Positions</strong>.</> },
                ]}
              />
            </Section>

            <Section id="tut-limit" eyebrow="Tutorials" title="Place a limit order" icon={<TargetIcon />}>
              <p>
                Limit orders rest on the orderbook at your price. If your price crosses the spread,
                the order fills as a taker.
              </p>
              <Steps
                steps={[
                  { title: "Switch to Limit", body: <>Click <strong>Limit</strong> on the Trade screen.</> },
                  { title: "Set price", body: <>Type a price below mid (for a long) or above mid (for a short).</> },
                  { title: "Modifiers", body: <>Optional: tick <strong>Post-only</strong> (refuse cross), <strong>Reduce-only</strong> (stops only).</> },
                  { title: "Time in force", body: <>GTC to rest, IOC to fill-or-cancel, FOK to fill-in-full-or-cancel.</> },
                  { title: "Sign", body: <>The order lives in <strong>Open orders</strong> until it fills or you cancel.</> },
                ]}
              />
            </Section>

            <Section id="tut-session" eyebrow="Tutorials" title="Approve a session key" icon={<KeyIcon />}>
              <Steps
                steps={[
                  { title: "Open Sessions", body: <>Go to <Link href="/wallet">Wallet → Sessions</Link>.</> },
                  { title: "New session", body: <>Click <strong>New session</strong>.</> },
                  { title: "Set bounds", body: <>Expiry (default 4h), max notional, allowed markets.</> },
                  { title: "Sign once", body: <>Sign the SessionKey approval with your wallet. The only popup for the session lifetime.</> },
                  { title: "Trade", body: <>Orders are auto-signed by the session keypair stored in IndexedDB.</> },
                ]}
              />
              <Callout kind="warn">
                If you log out of the browser or clear site data, the session keypair is destroyed.
                You will need to approve a new session.
              </Callout>
            </Section>

            <Section id="tut-close" eyebrow="Tutorials" title="Close a position" icon={<ExitIcon />}>
              <Steps
                steps={[
                  { title: "Find your position", body: <>From <strong>Positions</strong>, click your position row.</> },
                  { title: "Close", body: <>Click <strong>Close</strong> — places a reduce-only market order for the full size on the opposite side.</> },
                  { title: "Sign", body: <>Position closes at the next best opposing price, realising PnL into your collateral.</> },
                ]}
              />
              <p>
                For partial closes, place a manual reduce-only order with the size you want to
                unwind.
              </p>
            </Section>

            {/* ── Developers ────────────────────────────────────────────── */}
            <Section id="api-rest" eyebrow="Developers" title="REST API" icon={<ServerIcon />}>
              <p>
                Base URL <code>http://localhost:8080</code> in dev,{" "}
                <code>https://api.perplex.fi</code> in prod.
              </p>
              <div className="grid sm:grid-cols-2 gap-2 my-2">
                <Endpoint method="GET" path="/v1/markets" desc="All active markets + risk params" />
                <Endpoint method="GET" path="/v1/orderbook/{marketId}" desc="L2 snapshot" />
                <Endpoint method="GET" path="/v1/trades/{marketId}" desc="Recent public fills" />
                <Endpoint method="GET" path="/v1/funding/{marketId}" desc="Current rate + history" />
                <Endpoint method="POST" path="/v1/orders" desc="Place signed order (SIWE JWT)" />
                <Endpoint method="DELETE" path="/v1/orders/{orderId}" desc="Cancel" />
                <Endpoint method="GET" path="/v1/orders/open" desc="Open orders for caller" />
                <Endpoint method="GET" path="/v1/positions" desc="Positions + collateral" />
                <Endpoint method="GET" path="/v1/fills" desc="Historical fills" />
                <Endpoint method="GET" path="/v1/account/balance" desc="Vault + wallet USDC" />
              </div>
              <p>Full schema with example payloads lives in <code>api-contract.md</code>.</p>
            </Section>

            <Section id="api-ws" eyebrow="Developers" title="WebSocket channels" icon={<BroadcastIcon />}>
              <p>
                Connect to <code>ws://localhost:8081</code> (dev) or{" "}
                <code>wss://ws.perplex.fi</code> (prod). Subscribe via JSON envelope:
              </p>
              <Code language="json">{`{ "op": "subscribe", "channel": "orderbook.btc-usd" }`}</Code>
              <p>Public channels:</p>
              <ul>
                <li><code>orderbook.{`{marketId}`}</code> — snapshot + sequenced deltas at 10/s.</li>
                <li><code>trades.{`{marketId}`}</code> — every public fill.</li>
                <li><code>oracle.{`{marketId}`}</code> — index price ticks.</li>
                <li><code>funding.{`{marketId}`}</code> — funding rate + countdown.</li>
              </ul>
              <p>Private channel (requires JWT in connect query):</p>
              <ul>
                <li><code>account.{`{wallet}`}</code> — order acks, fills, position updates, liquidation warnings, funding payments.</li>
              </ul>
              <Callout kind="info">
                Apply orderbook deltas in <code>sequence</code> order. A gap means you missed a
                packet — drop and resubscribe.
              </Callout>
            </Section>

            {/* ── Other ──────────────────────────────────────────────────── */}
            <Section id="faq" eyebrow="Other" title="FAQ" icon={<HelpIcon />}>
              <FAQ
                items={[
                  { q: "Do I need to KYC?", a: <>No. Connect a wallet, trade.</> },
                  { q: "Where does my USDC sit?", a: <>In the Vault smart contract on Arbitrum. Withdraw any time.</> },
                  { q: "What chain runs the matching engine?", a: <>Off-chain matching, on-chain settlement on Arbitrum. Matching is faster than block time; settlement is final.</> },
                  { q: "Can I trade from mobile?", a: <>Yes. The Trade screen collapses to a tabbed layout at 768px.</> },
                  { q: "Are oracle prices manipulable?", a: <>Mark prices come from multiple sources with confidence intervals. Liquidation triggers fire only after consensus.</> },
                  { q: "What if I lose internet during a trade?", a: <>Signed orders are honored once the matching engine has them. Positions persist onchain regardless of connectivity.</> },
                  { q: "Is there an insurance fund?", a: <>Yes — funded by the 1% liquidation bonus. Backstops liquidations that fill below MM.</> },
                  { q: "Can I run my own frontend?", a: <>Yes. Perplex is open-source. Clone the repo, point at the public REST + WS endpoints, ship your own UI.</> },
                ]}
              />
            </Section>

            <Section id="risk" eyebrow="Other" title="Risk disclosure" icon={<WarnIcon />}>
              <p>
                Trading perpetual futures with leverage carries substantial risk. Funding rates,
                liquidation thresholds and oracle conditions vary per market. You may lose your
                entire collateral. Nothing in these docs is legal, financial, tax or investment
                advice. Perform your own research before placing any trade.
              </p>
            </Section>

            {/* ── Bottom CTA card ───────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-1)] p-8 sm:p-12 mt-8">
              <div
                aria-hidden
                className="absolute -inset-px rounded-[var(--radius-xl)] opacity-60"
                style={{
                  background:
                    "conic-gradient(from 180deg at 50% 50%, rgba(255,107,26,0.22), rgba(94,53,177,0.16), rgba(255,107,26,0.22))",
                  filter: "blur(60px)",
                }}
              />
              <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-6 justify-between">
                <div className="max-w-[42ch]">
                  <h3 className="font-display text-[clamp(24px,3vw,34px)] font-semibold tracking-[-0.02em] text-[var(--fg)]">
                    Ready to trade?
                  </h3>
                  <p className="text-[14px] text-[var(--fg-mid)] mt-2">
                    Connect a wallet, deposit USDC, place an order. Sub-second settlement on Arbitrum.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/trade/btc-usd"
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[var(--fg)] text-white text-[13px] font-semibold hover:bg-[var(--accent)] transition-colors"
                  >
                    Start trading
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </Link>
                  <a
                    href="https://github.com/ozpool/Perplex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-[var(--border-strong)] text-[var(--fg)] text-[13px] font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    <GitHubIcon /> Star on GitHub
                  </a>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── Helper cards ──────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] p-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-1.5">
        {label}
      </div>
      <div className="font-display text-[28px] sm:text-[34px] font-semibold tracking-[-0.02em] text-[var(--fg)] tabular-nums leading-none">
        {value}
      </div>
    </div>
  );
}

function TifCard({ tag, name, body }: { tag: string; name: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] p-5">
      <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--accent-soft)] text-[var(--accent-strong)] font-mono text-[11px] font-bold tracking-[0.12em]">
        {tag}
      </div>
      <div className="font-display text-[16px] font-semibold text-[var(--fg)] mt-3 mb-1">
        {name}
      </div>
      <p className="text-[13px] text-[var(--fg-mid)] leading-relaxed">{body}</p>
    </div>
  );
}

function FeeCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: "warm" | "cool" }) {
  const tag = tone === "warm" ? "var(--accent-soft)" : "color-mix(in oklab, var(--long), transparent 86%)";
  const valColor = tone === "warm" ? "var(--accent-strong)" : "var(--long-strong)";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] p-5 flex items-center justify-between gap-4">
      <div>
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          {label}
        </div>
        <div className="text-[12px] text-[var(--fg-mid)] mt-1.5 max-w-[20ch]">{note}</div>
      </div>
      <div
        className="font-display text-[28px] font-semibold tracking-[-0.02em] tabular-nums px-3 py-1.5 rounded-md"
        style={{ background: tag, color: valColor }}
      >
        {value}
      </div>
    </div>
  );
}

function OrderTypeCard({
  name,
  role,
  tone,
  body,
  bullets,
  icon,
}: {
  name: string;
  role: string;
  tone: "warm" | "cool";
  body: string;
  bullets: string[];
  icon: React.ReactNode;
}) {
  const accent = tone === "warm" ? "var(--accent)" : "var(--info)";
  const accentStrong = tone === "warm" ? "var(--accent-strong)" : "#1c6bc4";
  const tint =
    tone === "warm"
      ? "color-mix(in oklab, var(--accent), transparent 92%)"
      : "color-mix(in oklab, var(--info), transparent 92%)";
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-lg)] border p-6"
      style={{ borderColor: accent, background: tint }}
    >
      <div
        aria-hidden
        className="absolute -right-12 -top-12 size-40 rounded-full blur-3xl opacity-30"
        style={{ background: accent }}
      />
      <div className="relative flex items-start justify-between gap-3 mb-4">
        <div
          className="size-11 rounded-2xl flex items-center justify-center text-white"
          style={{ background: accentStrong }}
        >
          {icon}
        </div>
        <span
          className="inline-flex items-center px-2.5 h-6 rounded-full text-[10px] font-mono uppercase tracking-[0.18em] font-bold text-white"
          style={{ background: accentStrong }}
        >
          {role}
        </span>
      </div>
      <h4
        className="relative font-display text-[26px] font-semibold tracking-[-0.02em] mb-2"
        style={{ color: accentStrong }}
      >
        {name}
      </h4>
      <p className="relative text-[14px] text-[var(--fg-mid)] leading-relaxed mb-4">{body}</p>
      <ul className="relative flex flex-col gap-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2 text-[13px] text-[var(--fg)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={accentStrong} strokeWidth="2.8">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModifierCard({
  name,
  body,
  icon,
}: {
  name: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] p-5 hover:border-[var(--accent)] transition-colors">
      <div className="size-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)] flex items-center justify-center mb-3">
        {icon}
      </div>
      <div className="font-display text-[15px] font-semibold text-[var(--fg)] mb-1.5">{name}</div>
      <p className="text-[13px] text-[var(--fg-mid)] leading-relaxed">{body}</p>
    </div>
  );
}

function PinIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v8M5 10h14l-2 4H7l-2-4zM12 14v8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const palette =
    method === "GET"
      ? { color: "var(--info)", strong: "#1c6bc4", bg: "color-mix(in oklab, var(--info), transparent 94%)" }
      : method === "POST"
        ? { color: "var(--long)", strong: "var(--long-strong)", bg: "color-mix(in oklab, var(--long), transparent 94%)" }
        : { color: "var(--short)", strong: "var(--short-strong)", bg: "color-mix(in oklab, var(--short), transparent 94%)" };

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] hover:border-[var(--border-strong)] transition-colors flex items-stretch"
    >
      {/* Vertical method stripe */}
      <div
        className="shrink-0 w-[78px] flex items-center justify-center"
        style={{ background: palette.bg, borderRight: `1px solid ${palette.color}` }}
      >
        <span
          className="font-mono text-[11px] font-bold tracking-[0.14em]"
          style={{ color: palette.strong }}
        >
          {method}
        </span>
      </div>

      <div className="flex-1 min-w-0 px-4 py-3.5 flex flex-col justify-center">
        <span
          className="font-mono text-[13px] text-[var(--fg)] truncate leading-tight"
          style={{
            background: "transparent",
            padding: 0,
            borderRadius: 0,
          }}
        >
          {path}
        </span>
        <span className="text-[12px] text-[var(--fg-mid)] truncate mt-1 leading-tight">{desc}</span>
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function PlayIcon() { return <svg width="18" height="18" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.6v8.8L10 6z"/></svg>; }
function BoltIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>; }
function CoinIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9 9.5c.5-1 1.8-1.5 3-1.5 1.7 0 3 .8 3 2s-1 1.7-3 2-3 1-3 2 1.3 2 3 2c1.3 0 2.5-.5 3-1.5M12 6v12"/></svg>; }
function InfinityIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12c0-3 2.5-5 5-5s5 3 5 5 2.5 5 5 5-2.5-5-5-5-2.5 5-5 5-5-2-5-5z"/></svg>; }
function ShieldIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" strokeLinejoin="round"/></svg>; }
function RefreshIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 0114-7.5L21 8M3 8v0M21 12a9 9 0 01-14 7.5L3 16M21 16v0"/></svg>; }
function WarnIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4l9 16H3L12 4zM12 10v5M12 18h.01"/></svg>; }
function OrderIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16"/></svg>; }
function ClockIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>; }
function KeyIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="15" r="3.5"/><path d="M10.5 13L20 3.5M16 7l2 2M18 5l2 2"/></svg>; }
function SignIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17c2-2 5-3 7-1s5 0 7-2 4-1 4-1" strokeLinecap="round"/><path d="M3 21h18" strokeLinecap="round"/></svg>; }
function RocketIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 19l-2-2 3-3M9 15l-4 4M13 4s7 1 7 7-7 7-7 7-7-7-7-7M14 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/></svg>; }
function TargetIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>; }
function ExitIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3h5v18h-5M3 12h12M11 8l4 4-4 4"/></svg>; }
function ServerIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>; }
function BroadcastIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="2"/><path d="M16 8a5 5 0 010 8M8 8a5 5 0 000 8M19 5a9 9 0 010 14M5 5a9 9 0 000 14"/></svg>; }
function HelpIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 16h.01" strokeLinecap="round"/></svg>; }
function GitHubIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>; }

/* ── Docs hero side preview ─────────────────────────────────────────────── */
function ApiPreview() {
  return (
    <div className="relative hidden lg:block">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[28px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 30% 0%, rgba(255,107,26,0.18) 0%, transparent 55%), radial-gradient(circle at 80% 100%, rgba(94,53,177,0.15) 0%, transparent 55%)",
          filter: "blur(20px)",
        }}
      />
      <div className="relative rounded-[20px] overflow-hidden border border-[var(--border)] shadow-[0_2px_0_rgba(15,8,52,0.04),0_24px_48px_-24px_rgba(15,8,52,0.35)]">
        <div className="flex items-center justify-between pl-4 pr-3 h-9 bg-[#0c0530] text-white">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#ff6b6b]" />
            <span className="size-2 rounded-full bg-[#ffd76e]" />
            <span className="size-2 rounded-full bg-[#5fd7d3]" />
            <span className="ml-3 text-[10px] font-mono uppercase tracking-[0.18em] text-white/55">
              perplex-api · place order
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-300/80">200 OK · 14 ms</span>
        </div>
        <pre
          className="px-5 py-4 overflow-hidden text-[12px] leading-[1.65] font-mono tabular-nums whitespace-pre"
          style={{ background: "#14102e", color: "#e6e4f5" }}
        >
{`POST /v1/orders
{
  "market":  "BTC-USD",
  "side":    "buy",
  "type":    "limit",
  "size":    "0.25",
  "price":   "98500",
  "tif":     "GTC",
  "sig":     "0x7c…91a"
}

← 200
{
  "id":      "ord_7ZQK9P",
  "status":  "open",
  "filled":  "0",
  "remain":  "0.25"
}`}
        </pre>
        <div className="flex items-center gap-2 px-4 h-9 bg-[#0c0530] text-white/65 text-[10px] font-mono uppercase tracking-[0.14em]">
          <span className="size-1.5 rounded-full bg-emerald-400 pulse-dot" />
          live mainnet · arbitrum
        </div>
      </div>

      <div className="absolute -left-6 -bottom-6 rounded-[14px] bg-[var(--bg-1)] border border-[var(--border)] px-3 py-2.5 shadow-[0_8px_24px_-12px_rgba(15,8,52,0.32)] flex items-center gap-2.5">
        <span className="inline-flex items-center justify-center size-7 rounded-[8px] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <BoltIcon />
        </span>
        <div className="leading-tight">
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--fg-muted)]">avg fill</div>
          <div className="font-mono text-[14px] text-[var(--fg)] font-semibold tabular-nums">14 ms</div>
        </div>
      </div>
    </div>
  );
}
