interface Props {
  items: { q: string; a: React.ReactNode }[];
}

export function FAQ({ items }: Props) {
  return (
    <div className="flex flex-col gap-2 my-2">
      {items.map((it, i) => (
        <details
          key={i}
          className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-1)] open:border-[var(--accent)] open:shadow-[0_8px_24px_-14px_rgba(255,107,26,0.4)] transition-colors"
        >
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 p-4 text-[15px] font-medium text-[var(--fg)]">
            <span>{it.q}</span>
            <span
              aria-hidden
              className="shrink-0 size-7 inline-flex items-center justify-center rounded-full bg-[var(--bg-2)] text-[var(--accent-strong)] transition-transform group-open:rotate-45 group-open:bg-[var(--accent)] group-open:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </span>
          </summary>
          <div className="px-4 pb-5 -mt-1 text-[14px] text-[var(--fg-mid)] leading-relaxed [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--bg-2)] [&_code]:text-[var(--fg)] [&_strong]:text-[var(--fg)] [&_strong]:font-semibold">
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}
