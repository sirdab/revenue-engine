import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";
import {
  ACTIVITY_PRIORITY_META,
  ACTIVITY_PRIORITY_ORDER,
  activityPriorityOf,
} from "./activity-priority";

// The deal activity-priority dot + legend (board card + list row).
// The 4-state derivation, palette, and ordering live in ./activity-priority
// (pure, unit-tested); this file is only the presentation.

/**
 * The dot itself. Pass a deal's `nextActivityDueDate`. On the board card, pass
 * `className="relative z-10"` so the `title` tooltip is hoverable above the
 * card's StretchedLink overlay (see board.tsx).
 */
export function ActivityPriorityDot({
  nextActivityDueDate,
  className,
}: {
  nextActivityDueDate?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const meta = ACTIVITY_PRIORITY_META[activityPriorityOf(nextActivityDueDate)];
  return (
    <span
      role="img"
      aria-label={t("deals.priority.nextActivity", { label: t(meta.label) })}
      title={t(meta.label)}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", meta.dot, className)}
    />
  );
}

/** The 4-colour legend for the board toolbar. */
export function ActivityPriorityLegend({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {ACTIVITY_PRIORITY_ORDER.map((p) => (
        <span key={p} className="flex items-center gap-1">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              ACTIVITY_PRIORITY_META[p].dot,
            )}
          />
          {t(ACTIVITY_PRIORITY_META[p].label)}
        </span>
      ))}
    </div>
  );
}
