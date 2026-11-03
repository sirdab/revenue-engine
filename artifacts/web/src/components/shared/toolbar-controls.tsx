import { ChevronDown, ChevronUp, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// Shared header-control primitives so every list page shows the same cluster in
// the same order and position: [filters arrow] [view switcher] [refresh]
// [primary button], right-aligned. The arrow and refresh are matched icon
// buttons (same size, border, hover state) so they read as a set.

const ICON_BUTTON =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border " +
  "border-slate-200 bg-card text-slate-500 transition-colors " +
  "hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 " +
  "disabled:pointer-events-none disabled:opacity-60";

/** The collapse/expand-filters chevron — leftmost control in the cluster.
 *  `activeCount` marks the button when filters are applied, so a collapsed
 *  panel can never hide active filters: restored/persisted filters must
 *  always be visible, even when their controls aren't. */
export function FiltersToggle({
  open,
  onToggle,
  activeCount = 0,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  /** Number of currently applied filters (shown as a badge when collapsed). */
  activeCount?: number;
  className?: string;
}) {
  const { t } = useI18n();
  const label = open
    ? t("filters.collapse")
    : activeCount > 0
      ? t("filters.expandActive", { count: activeCount })
      : t("filters.expand");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={cn(ICON_BUTTON, "relative", className)}
    >
      {open ? (
        <ChevronUp className="h-4 w-4" />
      ) : (
        <ChevronDown className="h-4 w-4" />
      )}
      {!open && activeCount > 0 && (
        <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold tabular-nums text-white">
          {activeCount}
        </span>
      )}
    </button>
  );
}

/** Icon-only refresh with a hover state — sits just left of the primary button. */
export function RefreshButton({
  refreshing,
  onClick,
  className,
}: {
  refreshing: boolean;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
      className={cn(ICON_BUTTON, className)}
    >
      {refreshing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
    </button>
  );
}
