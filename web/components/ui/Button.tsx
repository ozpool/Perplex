import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "long" | "short" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

const sizeCls: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)]",
  md: "h-10 px-4 text-sm rounded-[var(--radius-md)]",
  lg: "h-12 px-5 text-[15px] rounded-[var(--radius-md)]",
};

const variantCls: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-strong active:translate-y-px font-medium shadow-[0_0_0_1px_var(--accent-strong)]",
  secondary:
    "bg-bg-2 text-fg hover:bg-bg-hover border border-border hover:border-border-strong font-medium",
  ghost:
    "bg-transparent text-fg-mid hover:text-fg hover:bg-bg-2",
  long:
    "bg-long text-white hover:bg-long-strong font-semibold shadow-[0_0_0_1px_var(--long-strong)]",
  short:
    "bg-short text-white hover:bg-short-strong font-semibold shadow-[0_0_0_1px_var(--short-strong)]",
  danger:
    "bg-short-soft text-short border border-[var(--short-strong)] hover:bg-short hover:text-white",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", loading, block, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors duration-150 select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        sizeCls[size],
        variantCls[variant],
        block && "w-full",
        className
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="inline-block size-3 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
});
