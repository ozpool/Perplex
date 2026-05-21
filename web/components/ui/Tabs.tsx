"use client";
import { cn } from "@/lib/cn";

interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode; count?: number }[];
  size?: "sm" | "md";
  variant?: "underline" | "pill" | "segmented";
  className?: string;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  variant = "underline",
  className,
}: TabsProps<T>) {
  const isUnderline = variant === "underline";
  const isPill = variant === "pill";
  const isSeg = variant === "segmented";

  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center",
        isSeg && "p-1 bg-bg-2 border border-border rounded-[var(--radius-md)] gap-1",
        isUnderline && "gap-4 border-b border-border",
        isPill && "gap-1",
        className
      )}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "transition-colors duration-150 select-none whitespace-nowrap",
              size === "sm" ? "text-[12px]" : "text-[13px]",
              isUnderline && cn(
                "h-9 -mb-px border-b-2 px-1",
                active
                  ? "text-fg border-accent"
                  : "text-fg-muted hover:text-fg-mid border-transparent"
              ),
              isPill && cn(
                "h-8 px-3 rounded-[var(--radius-sm)]",
                active ? "bg-accent-soft text-accent" : "text-fg-muted hover:text-fg"
              ),
              isSeg && cn(
                "h-7 px-3 rounded-[var(--radius-sm)] font-medium flex-1 text-center",
                active ? "bg-bg-hover text-fg" : "text-fg-muted hover:text-fg"
              )
            )}
          >
            <span className="flex items-center gap-1.5">
              {it.label}
              {typeof it.count === "number" && (
                <span
                  className={cn(
                    "px-1.5 h-4 inline-flex items-center justify-center text-[10px] rounded-full font-mono",
                    active ? "bg-accent-soft text-accent" : "bg-bg-2 text-fg-muted"
                  )}
                >
                  {it.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
