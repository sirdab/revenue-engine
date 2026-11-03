import { Segmented, SegmentedItem } from "@sirdab/one/components/segmented";
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
  const OPEN = "open";
  const selected =
    value === undefined
      ? OPEN
      : OPTIONS.some((o) => o.value === value)
        ? value
        : "";
  return (
    <Segmented
      aria-label={t("deals.statusFilter.aria")}
      value={selected}
      onValueChange={(next) => onChange(next === OPEN ? undefined : next)}
    >
      {OPTIONS.map((option) => (
        <SegmentedItem
          key={option.label}
          value={option.value ?? OPEN}
          label={t(option.label)}
        />
      ))}
    </Segmented>
  );
}
