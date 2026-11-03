import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { formatMonthDay } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { getListActivitiesQueryKey } from "@workspace/api-client-react";
import { useActivitySearch } from "@/lib/contacts-search-api";
import { ACTIVITY_TYPE_CONFIG } from "@/components/activities/activity-fields";
import { useMarkActivityDone } from "@/components/activities/mark-activity-done";
import { useDeleteActivityWithConfirm } from "@/components/activities/delete-activity";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetCard } from "./widget-card";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

type Bucket = "overdue" | "today" | "upcoming";

const TABS: { key: Bucket; label: MessageKey; dot: string }[] = [
  { key: "overdue", label: "activity.status.overdue", dot: "bg-destructive" },
  { key: "today", label: "activity.status.today", dot: "bg-warning" },
  { key: "upcoming", label: "activity.status.upcoming", dot: "bg-attention" },
];

export function TasksWidget({ userId }: { userId: number }) {
  const { t: tr } = useI18n();
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  // Completing a task opens the shared confirm-with-details dialog (same flow as
  // the Activities page) rather than an instant one-click toggle. onAfter runs
  // on success, so the widget's list still refreshes once the task is done.
  const { toggle, dialog } = useMarkActivityDone(() => {
    queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
  });
  const { remove: removeActivity } = useDeleteActivityWithConfirm();

  // Tab defaults to Overdue when anything is overdue, else Today — but a
  // manual selection always wins.
  const [selected, setSelected] = useState<Bucket | null>(null);
  const [autoTab, setAutoTab] = useState<Bucket>("today");
  const tab = selected ?? autoTab;

  const { data, isLoading, isError, refetch } = useActivitySearch({
    ownerId: userId,
    bucket: tab,
    today,
    limit: 8,
    sort: "dueDate:asc",
  });
  const buckets = data?.buckets;

  useEffect(() => {
    if (selected === null && buckets) {
      setAutoTab(buckets.overdue > 0 ? "overdue" : "today");
    }
  }, [selected, buckets]);

  const emptyText =
    tab === "overdue"
      ? tr("home.tasks.emptyOverdue")
      : tab === "today"
        ? tr("home.tasks.emptyToday")
        : tr("home.tasks.emptyUpcoming");

  return (
    <>
    <WidgetCard
      title={tr("home.tasks.title")}
      action={{ label: tr("common.viewAll"), href: "/activities" }}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    >
      {data && (
        <div>
          <div className="mb-2 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelected(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium",
                  tab === t.key
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-row-surface-hover",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
                {tr(t.label)}
                <span className="tabular-nums">{buckets?.[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          {data.items.length === 0 ? (
            <p className="rounded-lg bg-surface-whisper px-3 py-6 text-center text-body text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.items.map((a) => {
                const meta = ACTIVITY_TYPE_CONFIG[a.type];
                return (
                  <div key={a.id} className="group flex items-center gap-3 py-2">
                    <Checkbox
                      aria-label={tr("home.tasks.markDone", { subject: a.subject })}
                      checked={a.done}
                      onCheckedChange={() => toggle(a)}
                    />
                    <meta.Icon
                      className={cn("h-4 w-4 shrink-0", meta.iconColor)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-foreground">
                        {a.subject}
                      </p>
                      {(a.dealTitle || a.personName) && (
                        <p className="truncate text-caption text-muted-foreground">
                          {a.dealTitle ?? a.personName}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-caption tabular-nums",
                        tab === "overdue" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {a.dueDate ? formatMonthDay(parseISO(a.dueDate)) : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeActivity(a)}
                      aria-label={tr("activities.deleteSubject", { subject: a.subject })}
                      title={tr("activity.row.delete")}
                      className="rounded-sm p-1 text-subtle transition-colors hover:bg-destructive-subtle hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
      {dialog}
    </>
  );
}
