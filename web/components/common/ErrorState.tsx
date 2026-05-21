import { cn } from "@/lib/cn";

interface Props {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export function ErrorState({ title = "Something went wrong", description, onRetry, className, compact }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--short-strong),transparent_70%)] bg-short-soft",
        compact ? "p-6" : "p-10",
        className
      )}
      role="alert"
    >
      <div className="size-9 rounded-full bg-short-soft border border-short flex items-center justify-center text-short">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <div className="text-sm text-fg">{title}</div>
      {description && <div className="text-xs text-fg-muted max-w-[42ch]">{description}</div>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs px-3 h-7 rounded-[var(--radius-sm)] bg-bg-2 hover:bg-bg-hover border border-border text-fg"
        >
          Retry
        </button>
      )}
    </div>
  );
}
