// Inline SVG explainers — visual scaffolding for the docs concepts.

export function MarginDiagram() {
  return (
    <div className="relative my-4 rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border)] shadow-[0_2px_0_rgba(15,8,52,0.04),0_18px_36px_-18px_rgba(255,107,26,0.18)]">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 25% 0%, rgba(255,107,26,0.10) 0%, transparent 55%), radial-gradient(circle at 80% 100%, rgba(94,53,177,0.10) 0%, transparent 55%), var(--bg-1)",
        }}
      />
      <div className="relative p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--accent-strong)]">
            Collateral mechanics
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--fg-muted)]">
            cross-margin
          </div>
        </div>

        <svg viewBox="0 0 640 260" className="w-full h-auto">
          <defs>
            <linearGradient id="usedG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffb27a" />
              <stop offset="1" stopColor="#d9531d" />
            </linearGradient>
            <linearGradient id="freeG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#5e35b1" />
            </linearGradient>
            <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%">
              <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000" floodOpacity="0.15" />
            </filter>
          </defs>

          <text x="320" y="32" textAnchor="middle" fill="var(--fg)" fontFamily="var(--font-space-grotesk)" fontSize="16" fontWeight="700">
            Total USDC collateral
          </text>

          {/* Bar */}
          <g filter="url(#cardShadow)">
            <rect x="40" y="70" width="560" height="80" rx="20" fill="var(--bg-2)" />
            <rect x="44" y="74" width="208" height="72" rx="16" fill="url(#usedG)" />
            <rect x="256" y="74" width="340" height="72" rx="16" fill="url(#freeG)" />
          </g>

          {/* Section labels INSIDE bars */}
          <text x="148" y="108" textAnchor="middle" fill="white" fontFamily="var(--font-space-grotesk)" fontSize="20" fontWeight="800" letterSpacing="2">
            USED
          </text>
          <text x="148" y="130" textAnchor="middle" fill="rgba(255,255,255,0.78)" fontFamily="var(--font-jbmono)" fontSize="11">
            37% of collateral
          </text>
          <text x="426" y="108" textAnchor="middle" fill="white" fontFamily="var(--font-space-grotesk)" fontSize="20" fontWeight="800" letterSpacing="2">
            FREE
          </text>
          <text x="426" y="130" textAnchor="middle" fill="rgba(255,255,255,0.78)" fontFamily="var(--font-jbmono)" fontSize="11">
            63% of collateral
          </text>

          {/* Bracket lines under each band */}
          <path d="M 44 168 L 44 178 L 252 178 L 252 168" fill="none" stroke="#d9531d" strokeWidth="1.4" />
          <path d="M 256 168 L 256 178 L 596 178 L 596 168" fill="none" stroke="#5e35b1" strokeWidth="1.4" />

          {/* Labels */}
          <text x="148" y="200" textAnchor="middle" fill="#d9531d" fontFamily="var(--font-space-grotesk)" fontSize="15" fontWeight="700">
            Initial Margin
          </text>
          <text x="148" y="220" textAnchor="middle" fill="var(--fg-mid)" fontFamily="var(--font-jbmono)" fontSize="12">
            notional × IM%
          </text>
          <text x="148" y="240" textAnchor="middle" fill="var(--fg-muted)" fontFamily="var(--font-jbmono)" fontSize="11">
            locked until close
          </text>

          <text x="426" y="200" textAnchor="middle" fill="#5e35b1" fontFamily="var(--font-space-grotesk)" fontSize="15" fontWeight="700">
            Free collateral
          </text>
          <text x="426" y="220" textAnchor="middle" fill="var(--fg-mid)" fontFamily="var(--font-jbmono)" fontSize="12">
            backs PnL swings + new trades
          </text>
          <text x="426" y="240" textAnchor="middle" fill="var(--fg-muted)" fontFamily="var(--font-jbmono)" fontSize="11">
            withdrawable any time
          </text>
        </svg>
      </div>
    </div>
  );
}

export function FundingDiagram() {
  return (
    <div className="relative my-4 rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border)] shadow-[0_2px_0_rgba(15,8,52,0.04),0_18px_36px_-18px_rgba(255,107,26,0.18)]">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(255,107,26,0.10) 0%, transparent 55%), var(--bg-1)",
        }}
      />
      <div className="relative p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--accent-strong)]">
            Funding flow · every 8h
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--fg-muted)]">
            arrow reverses when funding &lt; 0
          </div>
        </div>

        <svg viewBox="0 0 720 240" className="w-full h-auto">
          <defs>
            <marker id="arrowR" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#d9531d" />
            </marker>
            <linearGradient id="longBox" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#34c485" />
              <stop offset="1" stopColor="#0a8a57" />
            </linearGradient>
            <linearGradient id="shortBox" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff7e8e" />
              <stop offset="1" stopColor="#b32034" />
            </linearGradient>
            <linearGradient id="arrowG" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffb27a" />
              <stop offset="1" stopColor="#d9531d" />
            </linearGradient>
          </defs>

          {/* Long box */}
          <rect x="30" y="60" width="200" height="120" rx="18" fill="url(#longBox)" />
          <text x="130" y="106" textAnchor="middle" fill="white" fontFamily="var(--font-space-grotesk)" fontSize="26" fontWeight="800" letterSpacing="2">LONGS</text>
          <text x="130" y="138" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-jbmono)" fontSize="12">pay when</text>
          <text x="130" y="156" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-jbmono)" fontSize="12">funding &gt; 0</text>

          {/* Formula label above arrow */}
          <text x="360" y="92" textAnchor="middle" fill="#d9531d" fontFamily="var(--font-jbmono)" fontSize="13" fontWeight="700">
            fundingRate
          </text>
          <text x="360" y="112" textAnchor="middle" fill="#d9531d" fontFamily="var(--font-jbmono)" fontSize="13" fontWeight="700">
            × notional × Δt
          </text>
          {/* Arrow */}
          <line x1="250" y1="135" x2="470" y2="135" stroke="url(#arrowG)" strokeWidth="4" markerEnd="url(#arrowR)" />

          {/* Short box */}
          <rect x="490" y="60" width="200" height="120" rx="18" fill="url(#shortBox)" />
          <text x="590" y="106" textAnchor="middle" fill="white" fontFamily="var(--font-space-grotesk)" fontSize="26" fontWeight="800" letterSpacing="2">SHORTS</text>
          <text x="590" y="138" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-jbmono)" fontSize="12">receive when</text>
          <text x="590" y="156" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-jbmono)" fontSize="12">funding &gt; 0</text>

          <text x="360" y="215" textAnchor="middle" fill="var(--fg-muted)" fontFamily="var(--font-jbmono)" fontSize="11">
            Settles every 28 800 seconds  ·  paid in USDC
          </text>
        </svg>
      </div>
    </div>
  );
}

export function LiqDiagram() {
  return (
    <div className="relative my-4 rounded-[var(--radius-lg)] overflow-hidden border border-[var(--border)] shadow-[0_2px_0_rgba(15,8,52,0.04),0_18px_36px_-18px_rgba(214,48,68,0.18)]">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 15% 50%, rgba(214,48,68,0.10) 0%, transparent 50%), radial-gradient(circle at 90% 50%, rgba(15,165,106,0.08) 0%, transparent 50%), var(--bg-1)",
        }}
      />
      <div className="relative p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--accent-strong)]">
            Long position · liquidation zone
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--fg-muted)]">
            10× leverage example
          </div>
        </div>

        <svg viewBox="0 0 720 220" className="w-full h-auto">
          <defs>
            <linearGradient id="trackG" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#d63044" />
              <stop offset="0.25" stopColor="#ffb27a" />
              <stop offset="0.55" stopColor="#34c485" />
              <stop offset="1" stopColor="#0a8a57" />
            </linearGradient>
          </defs>

          {/* Track */}
          <rect x="40" y="100" width="640" height="18" rx="9" fill="url(#trackG)" />

          {/* Mark price marker */}
          <line x1="400" y1="76" x2="400" y2="142" stroke="var(--fg)" strokeWidth="2.5" />
          <circle cx="400" cy="109" r="7" fill="var(--fg)" stroke="white" strokeWidth="2" />
          <rect x="344" y="48" width="112" height="24" rx="7" fill="var(--fg)" />
          <text x="400" y="65" textAnchor="middle" fill="white" fontFamily="var(--font-jbmono)" fontSize="11" fontWeight="700">MARK · $100k</text>

          {/* Entry */}
          <line x1="320" y1="86" x2="320" y2="134" stroke="#d9531d" strokeWidth="2" strokeDasharray="4 4" />
          <rect x="258" y="146" width="124" height="24" rx="7" fill="#d9531d" />
          <text x="320" y="163" textAnchor="middle" fill="white" fontFamily="var(--font-jbmono)" fontSize="11" fontWeight="700">ENTRY · $98.5k</text>

          {/* Liq */}
          <line x1="100" y1="86" x2="100" y2="134" stroke="#d63044" strokeWidth="2.5" strokeDasharray="4 4" />
          <rect x="44" y="146" width="112" height="24" rx="7" fill="#d63044" />
          <text x="100" y="163" textAnchor="middle" fill="white" fontFamily="var(--font-jbmono)" fontSize="11" fontWeight="700">LIQ · $94.2k</text>

          <text x="40" y="200" fill="var(--short)" fontFamily="var(--font-jbmono)" fontSize="11" fontWeight="600">← danger zone</text>
          <text x="680" y="200" textAnchor="end" fill="var(--long-strong)" fontFamily="var(--font-jbmono)" fontSize="11" fontWeight="600">safe zone →</text>
        </svg>
      </div>
    </div>
  );
}
