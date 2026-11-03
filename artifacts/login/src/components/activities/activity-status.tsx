import {
  CalendarClock,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PhoneMissed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// The statuses an activity can read as, and how each one looks. Which one
// an activity has is decided in one place for every surface:
// statusOf() in shared/activity-rules.ts — Upcoming until done, Today on its
// due date, Overdue from the next day, Done, or No reply when it was closed
// unanswered. The key stays "planned"; only the label reads "Upcoming".
export type ActivityStatus =
  | "done"
  | "noReply"
  | "overdue"
  | "today"
  | "planned";


// Base pill styling shared with other timeline chips (e.g. the Draft chip).
export const STATUS_PILL_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

export const STATUS_META: Record<
  ActivityStatus,
  { label: MessageKey; icon: ReactNode; className: string }
> = {
  done: {
    label: "activity.status.done",
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "border-brand-200 bg-brand-subtle text-brand",
  },
  noReply: {
    label: "activity.status.noReply",
    icon: <PhoneMissed className="h-3 w-3" />,
    className: "border-border bg-muted text-muted-foreground",
  },
  overdue: {
    label: "activity.status.overdue",
    icon: <AlertTriangle className="h-3 w-3" />,
    className: "border-destructive/30 bg-destructive-subtle text-destructive",
  },
  today: {
    label: "activity.status.today",
    icon: <CalendarClock className="h-3 w-3" />,
    className: "border-warning/30 bg-warning-subtle text-warning",
  },
  planned: {
    label: "activity.status.upcoming",
    icon: <Clock className="h-3 w-3" />,
    className: "border-border bg-surface-whisper text-muted-foreground",
  },
};

// Pill showing an activity's derived status. Renders as a button when `onClick`
// is supplied (e.g. the deal timeline toggles done), otherwise a static badge.
export function ActivityStatusBadge({
  status,
  onClick,
}: {
  status: ActivityStatus;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  const className = cn(STATUS_PILL_CLASS, meta.className);
  const label = t(meta.label);
  if (!onClick) {
    return (
      <span className={className}>
        {meta.icon}
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("activity.status.toggleDone")}
      className={cn(className, "transition-colors hover:opacity-80")}
    >
      {meta.icon}
      {label}
    </button>
  );
}
