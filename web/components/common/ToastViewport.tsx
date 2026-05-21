"use client";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/cn";

const kindCls = {
  info: "border-border bg-bg-2 text-fg",
  success: "border-[var(--long-strong)] bg-long-soft text-fg",
  warn: "border-[var(--warn)] bg-warn-soft text-fg",
  error: "border-[var(--short-strong)] bg-short-soft text-fg",
};

export function ToastViewport() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 4_500));
    return () => timers.forEach((id) => clearTimeout(id));
  }, [toasts, dismiss]);

  return (
    <div
      className="fixed z-50 right-4 bottom-[calc(var(--mobile-tab-h)+1rem)] md:bottom-4 flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "border rounded-[var(--radius-md)] px-3 py-2.5 shadow-[var(--shadow-elev-2)] flex items-start gap-2 animate-[fadeIn_180ms_ease-out]",
            kindCls[t.kind]
          )}
        >
          <span
            className={cn(
              "mt-1 size-1.5 rounded-full shrink-0",
              t.kind === "success" && "bg-long",
              t.kind === "error" && "bg-short",
              t.kind === "warn" && "bg-warn",
              t.kind === "info" && "bg-accent"
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium leading-tight">{t.title}</div>
            {t.body && <div className="text-[12px] text-fg-muted mt-0.5 leading-snug">{t.body}</div>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-fg-muted hover:text-fg text-xs px-1"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
