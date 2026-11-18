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
        "rounded-2xl bg-card shadow-card",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
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
              <h2 className="truncate text-label font-semibold text-foreground">
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
        className="text-caption text-muted-foreground"
      >
        {label}
      </div>
      <div className="mt-1 break-words text-body text-foreground">
        {children ??
          (hasValue ? value : <span className="text-subtle">—</span>)}
      </div>
    </div>
  );
}
