import { useMemo } from "react";
import {
  getListActivitiesQueryKey,
  getGetDealQueryKey,
  getGetActivityHistoryQueryKey,
} from "@workspace/api-client-react";
import type { Activity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DealSectionCard } from "./deal-section-card";
import { useDealActivityList } from "@/components/activities/mark-activity-done";
import { ActivityItem } from "@/components/activities/shared/activity-item";
import { dealToView } from "@/components/activities/shared/activity-source";
import { bucketOf as activityBucket } from "@/components/activities/shared/activity-rules";
import { useI18n } from "@/lib/i18n/i18n";

// Only open work is listed, so "done" never reaches this panel.
type Bucket = "overdue" | "today" | "upcoming";

function bucketOf(a: Activity, today: Date): Bucket | null {
  // Drafts aren't real tasks yet — they only appear in the timeline.
  if (a.draft) return null;
  const bucket = activityBucket(dealToView(a), today);
  return bucket === "done" ? null : bucket;
}

export function DealFocusPanel({
  dealId,
  activities,
  loading,
}: {
  dealId: number;
  activities: Activity[];
  loading?: boolean;
}) {
  const { t } = useI18n();
  const today = startOfDay(new Date());
  const queryClient = useQueryClient();
  const { source, controller, dialogs } = useDealActivityList(
    activities,
    (activityId) => {
      // Bare key + search: Home widgets, the Activities page and the
      // org/person lists read this activity too, not just this deal.
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
      queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      queryClient.invalidateQueries({
        queryKey: getGetActivityHistoryQueryKey(activityId),
      });
    },
  );

  const open = useMemo(() => {
    const order: Record<Bucket, number> = { overdue: 0, today: 1, upcoming: 2 };
    return activities
      .map((a) => ({ a, bucket: bucketOf(a, today) }))
      .filter((x): x is { a: Activity; bucket: Bucket } => x.bucket !== null)
      .sort((x, y) => {
        if (x.bucket !== y.bucket) return order[x.bucket] - order[y.bucket];
        return (x.a.dueDate ?? "").localeCompare(y.a.dueDate ?? "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  const overdueCount = open.filter((x) => x.bucket === "overdue").length;

  return (
    <>
    <DealSectionCard
      title={t("deals.focus.openTasks")}
      collapsible
      defaultOpen
      action={
        overdueCount > 0 ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 border border-red-100">
            {overdueCount} overdue
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : open.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2.5 text-xs text-teal-700">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>{t("deals.focus.caughtUp")}</span>
        </div>
      ) : (
        // The same row as every other activity list: this panel
        // is the deal's "Open" section.
        <ul className="space-y-2">
          {open.map(({ a }) => (
            <ActivityItem
              key={a.id}
              hideDeal
              view={dealToView(a)}
              source={source}
              controller={controller}
              today={today}
            />
          ))}
        </ul>
      )}
    </DealSectionCard>
    {dialogs}
    </>
  );
}
