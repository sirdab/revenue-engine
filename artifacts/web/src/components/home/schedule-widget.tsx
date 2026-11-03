import { useMemo } from "react";
import { format } from "date-fns";
import { useActivitySearch } from "@/lib/contacts-search-api";
import { ACTIVITY_TYPE_CONFIG } from "@/components/activities/activity-fields";
import { useDeleteActivityWithConfirm } from "@/components/activities/delete-activity";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetCard } from "./widget-card";
import { useI18n } from "@/lib/i18n/i18n";

export function ScheduleWidget({ userId }: { userId: number }) {
  const { t } = useI18n();
  const today = format(new Date(), "yyyy-MM-dd");
  const { data, isLoading, isError, refetch } = useActivitySearch({
    ownerId: userId,
    bucket: "today",
    today,
    limit: 100,
  });
  const { remove: removeActivity } = useDeleteActivityWithConfirm();

  const meetings = useMemo(() => {
    const items = (data?.items ?? []).filter(
      (a) => a.type === "meeting" || a.type === "call",
    );
    // Timed items first (by time), untimed last.
    return [...items].sort((a, b) =>
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99"),
    );
  }, [data?.items]);

  return (
    <WidgetCard
      title={t("home.schedule.title")}
      action={{ label: t("common.viewAll"), href: "/activities" }}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!!data && meetings.length === 0}
      emptyText={t("home.schedule.empty")}
    >
      <div className="divide-y divide-slate-100">
        {meetings.map((a) => {
          const meta = ACTIVITY_TYPE_CONFIG[a.type];
          return (
            <div key={a.id} className="group flex items-center gap-3 py-2">
              <span className="w-11 shrink-0 text-xs font-semibold tabular-nums text-slate-600">
                {a.dueTime ?? "—"}
              </span>
              <meta.Icon className={cn("h-4 w-4 shrink-0", meta.iconColor)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {a.subject}
                </p>
                {(a.personName || a.dealTitle) && (
                  <p className="truncate text-xs text-slate-500">
                    {a.personName ?? a.dealTitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeActivity(a)}
                aria-label={t("activities.deleteSubject", { subject: a.subject })}
                title={t("activity.row.delete")}
                className="rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
