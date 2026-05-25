// Static concentric rings + orbiting coin logos.
// Outer <g> rotates around svg centre (1300, 900) via CSS keyframes.
// Inner <g> counter-rotates in place via fill-box origin so glyph stays upright.

interface Coin {
  symbol: string;
  glyph: string;
  bg: string;
  fg: string;
  r: number;
  start: number;
  dur: number;
  ccw?: boolean;
}

const COINS: Coin[] = [
  { symbol: "BTC",  glyph: "₿", bg: "#f7931a", fg: "#ffffff", r: 395, start: 20,  dur: 28 },
  { symbol: "ETH",  glyph: "Ξ", bg: "#627eea", fg: "#ffffff", r: 490, start: 130, dur: 36, ccw: true },
  { symbol: "SOL",  glyph: "◎", bg: "#9945ff", fg: "#ffffff", r: 585, start: 240, dur: 44 },
  { symbol: "ZEC",  glyph: "Z", bg: "#ecb244", fg: "#1d1606", r: 680, start: 70,  dur: 54, ccw: true },
  { symbol: "DOGE", glyph: "Ð", bg: "#c2a633", fg: "#ffffff", r: 775, start: 310, dur: 64 },
];

export function RingBg() {
  const rings = Array.from({ length: 14 }, (_, i) => ({
    r: 110 + i * 95,
    opacity: Math.max(0.025, 0.16 - i * 0.011),
  }));

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <svg
        width="2600"
        height="1800"
        viewBox="0 0 2600 1800"
        className="shrink-0"
      >
        {rings.map((r) => (
          <circle
            key={r.r}
            cx="1300"
            cy="900"
            r={r.r}
            fill="none"
            stroke="var(--ring-stroke, #0c0530)"
            strokeOpacity={r.opacity}
            strokeWidth="1"
            shapeRendering="geometricPrecision"
          />
        ))}

        {COINS.map((c) => {
          const delay = -(c.start / 360) * c.dur;
          const outerCls = c.ccw ? "orbit-ccw" : "orbit-cw";
          const innerCls = c.ccw ? "orbit-counter-ccw" : "orbit-counter-cw";
          const cx = 1300;
          const cy = 900 - c.r;
          return (
            <g
              key={c.symbol}
              className={outerCls}
              style={{
                ["--orbit-dur" as string]: `${c.dur}s`,
                animationDelay: `${delay}s`,
              }}
            >
              <g transform={`translate(${cx} ${cy})`}>
                <g
                  className={innerCls}
                  style={{
                    ["--orbit-dur" as string]: `${c.dur}s`,
                    animationDelay: `${delay}s`,
                  }}
                >
                  <circle r={50} fill="#ffffff" opacity={0.96} />
                  <circle r={44} fill={c.bg} />
                  <text
                    x={0}
                    y={0}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={c.fg}
                    fontFamily="var(--font-space-grotesk), system-ui, sans-serif"
                    fontSize="56"
                    fontWeight="700"
                  >
                    {c.glyph}
                  </text>
                </g>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
