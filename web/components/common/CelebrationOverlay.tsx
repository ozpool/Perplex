"use client";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui-store";

const AUTO_DISMISS_MS = 1600;

export function CelebrationOverlay() {
  const celebration = useUi((s) => s.celebration);
  const dismiss = useUi((s) => s.dismissCelebration);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [celebration, dismiss]);

  if (!celebration) return null;

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        style={{ animation: "celebrationBackdrop 160ms ease-out both" }}
      />
      <div
        role="status"
        className="relative pointer-events-auto cursor-pointer w-[260px] rounded-[20px] border border-border-strong bg-bg-1/95 backdrop-blur-md px-6 py-7 flex flex-col items-center gap-3 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.55),0_0_0_1px_rgba(26,208,148,0.18),0_0_42px_-6px_rgba(26,208,148,0.35)]"
        style={{
          animation: "celebrationPop 320ms cubic-bezier(0.22, 1.4, 0.34, 1) both",
        }}
        onClick={dismiss}
      >
        <div className="relative size-16 flex items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(26,208,148,0.55) 0%, rgba(26,208,148,0) 70%)",
              animation: "celebrationRingPulse 900ms ease-out both",
            }}
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border border-[color-mix(in_oklab,var(--long),transparent_55%)]"
            style={{
              animation: "celebrationRingPulse 900ms 120ms ease-out both",
            }}
          />
          <span
            className="relative size-14 rounded-full flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, #1ad094 0%, #0c8f63 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 14px -4px rgba(26,208,148,0.55)",
            }}
          >
            <svg
              width="34"
              height="34"
              viewBox="0 0 32 32"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path className="celebration-tick" d="M7 17l5.5 5L25 10" />
            </svg>
          </span>
        </div>
        <div className="text-center">
          <div className="text-[15px] font-semibold text-fg leading-tight">
            {celebration.title}
          </div>
          {celebration.body && (
            <div className="text-[12px] text-fg-muted mt-1 leading-snug font-mono">
              {celebration.body}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
