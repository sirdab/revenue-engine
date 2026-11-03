import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// The list view defaults to open-only. This control is how that default becomes
// visible and reversible — previously the only way to see won/lost deals was
// the "Archive" tab, which was really a closed-deals lens with a misleading
// name (it had nothing to do with the `archived` column).
//
// `deleted` is deliberately absent: it stays reachable through the filter
// builder, the same as before, rather than earning a permanent slot here.

const OPTIONS = [
  { value: undefined, label: "deals.statusFilter.open" },
  { value: "won", label: "deals.statusFilter.won" },
  { value: "lost", label: "deals.statusFilter.lost" },
  { value: "all", label: "deals.statusFilter.all" },
] as const;

export function StatusFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (status: string | undefined) => void;
}) {
  const { t } = useI18n();
  // Anything not offered here (e.g. `deleted` set via the filter builder)
  // leaves every segment unselected rather than lighting up the wrong one.
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
      role="group"
      aria-label={t("deals.statusFilter.aria")}
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-card text-teal-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={active}
          >
            {t(option.label)}
          </button>
        );
      })}
    </div>
  );
}
