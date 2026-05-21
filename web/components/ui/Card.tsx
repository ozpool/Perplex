import { cn } from "@/lib/cn";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
  bordered?: boolean;
}

export function Card({ raised, bordered = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] overflow-hidden",
        raised ? "bg-bg-2" : "bg-bg-1",
        bordered && "border border-border",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 h-11 border-b border-border text-[12px] uppercase tracking-wider text-fg-muted font-medium",
        className
      )}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...rest} />;
}
