interface Props {
  id: string;
  eyebrow?: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({ id, eyebrow, title, icon, children }: Props) {
  return (
    <section id={id} className="scroll-mt-24 mb-24">
      {eyebrow && (
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[var(--accent-strong)] mb-3">
          {eyebrow}
        </div>
      )}
      <h2 className="group flex items-center gap-3 font-display text-[clamp(28px,3.6vw,42px)] font-semibold tracking-[-0.025em] text-[var(--fg)] mb-6">
        {icon && (
          <span
            className="inline-flex items-center justify-center size-10 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)] shrink-0"
            aria-hidden
          >
            {icon}
          </span>
        )}
        <span>{title}</span>
        <a
          href={`#${id}`}
          aria-label="Anchor"
          className="text-[var(--fg-muted)] opacity-0 group-hover:opacity-100 transition-opacity text-[20px] font-mono"
        >
          #
        </a>
      </h2>
      <div className="flex flex-col gap-4 text-[15px] leading-[1.7] text-[var(--fg-mid)] [&_strong]:text-[var(--fg)] [&_strong]:font-semibold [&_code]:font-mono [&_code]:text-[13px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--bg-2)] [&_code]:text-[var(--fg)] [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5 [&_li]:list-disc [&_li]:marker:text-[var(--accent)]">
        {children}
      </div>
    </section>
  );
}
