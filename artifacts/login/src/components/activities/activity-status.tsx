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


// Base pill styling shared with other timeline chips (e.g. the Draft chip):
// One's status chip (Badge tone) — a subtle tone fill, the tone's text step,
// always a word, never colour alone.
export const STATUS_PILL_CLASS =
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-caption whitespace-nowrap [&>svg]:size-3";

export const STATUS_META: Record<
  ActivityStatus,
  { label: MessageKey; icon: ReactNode; className: string }
> = {
  done: {
    label: "activity.status.done",
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: "bg-muted text-muted-foreground",
  },
  noReply: {
    label: "activity.status.noReply",
    icon: <PhoneMissed className="h-3 w-3" />,
    className: "bg-muted text-muted-foreground",
  },
  overdue: {
    label: "activity.status.overdue",
    icon: <AlertTriangle className="h-3 w-3" />,
    className: "bg-destructive-subtle text-destructive",
  },
  today: {
    label: "activity.status.today",
    icon: <CalendarClock className="h-3 w-3" />,
    className: "bg-attention-subtle text-attention",
  },
  planned: {
    label: "activity.status.upcoming",
    icon: <Clock className="h-3 w-3" />,
    className: "bg-muted text-foreground",
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
      className={cn(className, "cursor-pointer transition-opacity hover:opacity-80")}
    >
      {meta.icon}
      {label}
    </button>
  );
}
