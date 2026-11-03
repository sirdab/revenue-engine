import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function DealSectionCard({
  title,
  icon,
  action,
  collapsible = false,
  defaultOpen = true,
  bodyClassName,
  className,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <button
            type="button"
            disabled={!collapsible}
            onClick={() => collapsible && setOpen((v) => !v)}
            className={cn(
              "flex min-w-0 items-center gap-2",
              collapsible && "cursor-pointer",
            )}
          >
            {icon && <span className="shrink-0 text-subtle">{icon}</span>}
            {title && (
              <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </h2>
            )}
            {collapsible && (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-subtle transition-transform",
                  !open && "-rotate-90",
                )}
              />
            )}
          </button>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {open && <div className={cn("p-4", bodyClassName)}>{children}</div>}
    </section>
  );
}

export function DealField({
  label,
  children,
  value,
  className,
}: {
  label: string;
  children?: ReactNode;
  value?: ReactNode;
  className?: string;
}) {
  const hasValue = value !== undefined && value !== null && value !== "";
  return (
    <div className={cn("min-w-0", className)}>
      <div
        dir="auto"
        className="text-[10px] font-medium uppercase tracking-wide text-subtle"
      >
        {label}
      </div>
      <div className="mt-0.5 break-words text-sm text-foreground">
        {children ??
          (hasValue ? value : <span className="text-subtle">—</span>)}
      </div>
    </div>
  );
}
