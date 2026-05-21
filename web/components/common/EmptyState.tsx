import { cn } from "@/lib/cn";

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ title, description, action, icon, className, compact }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-2 grid-dots rounded-[var(--radius-md)]",
        compact ? "p-6" : "p-10",
        className
      )}
    >
      {icon ?? (
        <div className="size-9 rounded-full border border-border bg-bg-2 flex items-center justify-center text-fg-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
        </div>
      )}
      <div className="text-sm text-fg">{title}</div>
      {description && <div className="text-xs text-fg-muted max-w-[42ch]">{description}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
