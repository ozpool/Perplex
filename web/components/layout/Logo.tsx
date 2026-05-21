import Link from "next/link";
import { cn } from "@/lib/cn";
import { PerplexMark } from "@/components/spark/PerplexMark";

export function Logo({ className, label = true }: { className?: string; label?: boolean }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 hover:opacity-90 transition-opacity", className)}
      aria-label="Perplex home"
    >
      <PerplexMark size={22} />
      {label && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          perplex<span className="text-accent">.</span>
        </span>
      )}
    </Link>
  );
}
