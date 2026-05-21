import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type NativeInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix">;

interface Props extends NativeInputProps {
  label?: string;
  suffix?: React.ReactNode;
  prefix?: React.ReactNode;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, suffix, prefix, error, hint, mono = true, className, id, ...rest },
  ref
) {
  const inputId = id ?? rest.name;
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-[11px] uppercase tracking-wider text-fg-muted font-medium">
          {label}
        </label>
      )}
      <div
        className={cn(
          "flex items-center h-10 px-3 gap-2 bg-bg-2 border border-border rounded-[var(--radius-md)]",
          "focus-within:border-accent transition-colors",
          error && "border-short",
          className
        )}
      >
        {prefix && <span className="text-fg-muted text-xs">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          className={cn(
            "flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-fg-dim text-sm",
            mono && "font-mono"
          )}
          {...rest}
        />
        {suffix && <span className="text-fg-muted text-xs whitespace-nowrap">{suffix}</span>}
      </div>
      {(error || hint) && (
        <span className={cn("text-[11px]", error ? "text-short" : "text-fg-muted")}>{error ?? hint}</span>
      )}
    </div>
  );
});
