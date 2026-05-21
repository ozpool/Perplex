interface Props {
  steps: { title: string; body: React.ReactNode }[];
}

export function Steps({ steps }: Props) {
  return (
    <ol className="flex flex-col gap-3 my-2">
      {steps.map((s, i) => (
        <li
          key={i}
          className="flex gap-4 items-start p-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-1)] hover:border-[var(--border-strong)] transition-colors"
        >
          <div className="shrink-0 size-9 rounded-full bg-[var(--accent)] text-white inline-flex items-center justify-center font-display text-[15px] font-bold">
            {(i + 1).toString().padStart(2, "0")}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="font-display text-[16px] font-semibold text-[var(--fg)] mb-1.5">
              {s.title}
            </h4>
            <div className="text-[14px] text-[var(--fg-mid)] leading-relaxed [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--bg-2)] [&_code]:text-[var(--fg)] [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-[var(--fg)] [&_strong]:font-semibold">
              {s.body}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
