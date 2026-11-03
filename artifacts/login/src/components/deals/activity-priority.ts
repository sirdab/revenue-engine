import { parseISO, startOfDay } from "date-fns";
import type { MessageKey } from "../../lib/i18n/static";

// Pure derivation for a deal's activity-priority signal, split from
// the .tsx component so it imports no JSX/alias and can be unit-tested under
// `node --test` (the login suite resolves relative imports only, not the `@/`
// alias). The state comes from `Deal.nextActivityDueDate` (min due_date among
// the deal's open, non-draft activities; null when nothing is dated).
//
// This is intentionally its OWN red/amber/green/grey scheme, not the sky-blue
// activity-bucket palettes in deal-focus-panel / activities / tasks-widget
// (merging would recolour those surfaces). Matches Pipedrive.
//
// "Today" is the CLIENT-LOCAL day (caller-injectable for tests). The backend
// value is a plain calendar date, so near midnight this can disagree with the
// server (DB current_date, used by the reminder scheduler) by a day —
// acceptable, and consistent with the client-local Activities page.

export type ActivityPriority = "overdue" | "today" | "scheduled" | "none";

export const ACTIVITY_PRIORITY_META: Record<
  ActivityPriority,
  { label: MessageKey; dot: string }
> = {
  overdue: { label: "activity.status.overdue", dot: "bg-red-500" },
  today: { label: "deals.priority.dueToday", dot: "bg-amber-400" },
  scheduled: { label: "deals.priority.scheduled", dot: "bg-green-500" },
  none: { label: "deals.priority.none", dot: "bg-slate-300" },
};

// Legend order: most-urgent first.
export const ACTIVITY_PRIORITY_ORDER: ActivityPriority[] = [
  "overdue",
  "today",
  "scheduled",
  "none",
];

/** Derive the 4-state priority from a deal's `nextActivityDueDate` (nullable). */
export function activityPriorityOf(
  nextActivityDueDate: string | null | undefined,
  today: Date = startOfDay(new Date()),
): ActivityPriority {
  if (!nextActivityDueDate) return "none";
  const due = startOfDay(parseISO(nextActivityDueDate)).getTime();
  const t = today.getTime();
  if (due < t) return "overdue";
  if (due === t) return "today";
  return "scheduled";
}
