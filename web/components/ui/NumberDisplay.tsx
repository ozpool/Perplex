import { cn } from "@/lib/cn";

interface Props {
  value: string | number | null | undefined;
  decimals?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  signed?: boolean;
  colorBySign?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  align?: "left" | "right";
}

const sizes: Record<NonNullable<Props["size"]>, string> = {
  xs: "text-[11px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
};

export function NumberDisplay({
  value,
  decimals = 2,
  className,
  prefix,
  suffix,
  signed = false,
  colorBySign = false,
  size = "sm",
  align = "left",
}: Props) {
  if (value === null || value === undefined || value === "") {
    return <span className={cn("font-mono text-fg-dim", sizes[size], className)}>—</span>;
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) {
    return <span className={cn("font-mono text-fg-dim", sizes[size], className)}>—</span>;
  }
  const isNeg = n < 0;
  const isPos = n > 0;
  const display = (() => {
    const abs = Math.abs(n);
    const fixed = abs.toFixed(decimals);
    const [intPart, dec] = fixed.split(".");
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const body = dec ? `${withCommas}.${dec}` : withCommas;
    const signStr = signed ? (isPos ? "+" : isNeg ? "−" : "") : isNeg ? "−" : "";
    return `${signStr}${body}`;
  })();
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        sizes[size],
        align === "right" && "text-right",
        colorBySign && (isPos ? "text-long" : isNeg ? "text-short" : "text-fg-mid"),
        className
      )}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
