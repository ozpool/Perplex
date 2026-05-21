import { cn } from "@/lib/cn";

export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-[var(--radius-sm)] bg-gradient-to-r from-bg-2 via-bg-3 to-bg-2 bg-[length:200%_100%]",
        "animate-[shimmer_1.4s_ease-in-out_infinite]",
        className
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s ease-in-out infinite",
      }}
      {...rest}
    />
  );
}
