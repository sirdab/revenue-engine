import { addDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// One-tap due dates, so planning a follow-up never means typing a full date.
// Shared by every place an activity gets a due date (the composer, the edit
// dialog and the "what's next?" follow-up step), so the shortcuts and their
// look stay the same everywhere.
const QUICK_DUE: { label: MessageKey; days: number }[] = [
  { label: "common.today", days: 0 },
  { label: "common.tomorrow", days: 1 },
  { label: "activity.followUp.in3Days", days: 3 },
  { label: "activity.followUp.nextWeek", days: 7 },
];

export function DueDateChips({
  value,
  onChange,
  disabled,
  className,
}: {
  /** `yyyy-mm-dd`, or `""` for no date. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {QUICK_DUE.map(({ label, days }) => {
        const ymd = format(addDays(new Date(), days), "yyyy-MM-dd");
        const active = value === ymd;
        return (
          <button
            key={label}
            type="button"
            disabled={disabled}
            // Tapping the active chip again clears it (back to no date).
            onClick={() => onChange(active ? "" : ymd)}
            className={cn(
              "rounded-full border px-3 py-1 text-caption font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
              active
                ? "border-btn-border-hover bg-btn-ghost-surface-active text-foreground"
                : "border-border text-muted-foreground hover:border-input hover:bg-gray-alpha-50",
            )}
          >
            {t(label)}
          </button>
        );
      })}
    </div>
  );
}
