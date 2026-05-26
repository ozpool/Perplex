import { cn } from "@/lib/cn";
import { PerplexMark } from "@/components/spark/PerplexMark";

// The mark + wordmark. Inert by design - callers wrap in a Link when they
// want it clickable (TopNav -> /trade/<selectedMarket>, BootSplash -> nothing).
// Embedding an inner <Link> here would nest <a> tags and break HTML validation.
export function Logo({ className, label = true }: { className?: string; label?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", className)} aria-label="Perplex">
      <PerplexMark size={22} />
      {label && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          perplex<span className="text-accent">.</span>
        </span>
      )}
    </span>
  );
}
