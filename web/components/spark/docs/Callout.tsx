type Kind = "info" | "warn" | "tip";

const STYLE: Record<Kind, { bg: string; border: string; icon: string; label: string }> = {
  info: {
    bg: "color-mix(in oklab, var(--info), transparent 88%)",
    border: "var(--info)",
    icon: "i",
    label: "Note",
  },
  warn: {
    bg: "color-mix(in oklab, var(--warn), transparent 86%)",
    border: "var(--warn)",
    icon: "!",
    label: "Warning",
  },
  tip: {
    bg: "color-mix(in oklab, var(--accent), transparent 88%)",
    border: "var(--accent)",
    icon: "★",
    label: "Tip",
  },
};

export function Callout({
  kind = "info",
  children,
}: {
  kind?: Kind;
  children: React.ReactNode;
}) {
  const s = STYLE[kind];
  return (
    <div
      className="flex gap-3 rounded-[var(--radius-md)] border p-4 my-2"
      style={{ background: s.bg, borderColor: s.border }}
    >
      <span
        className="shrink-0 size-6 inline-flex items-center justify-center rounded-full text-white font-bold text-[12px]"
        style={{ background: s.border }}
      >
        {s.icon}
      </span>
      <div className="flex-1 text-[14px] leading-relaxed">
        <div className="font-semibold text-[var(--fg)] text-[12px] uppercase tracking-[0.12em] mb-1">
          {s.label}
        </div>
        {children}
      </div>
    </div>
  );
}
