import { useMemo } from "react";
import { startOfDay } from "date-fns";
import { ListChecks } from "lucide-react";
import type { Activity } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { DealSectionCard } from "@/components/deals/detail/deal-section-card";
import { ActivityItem } from "@/components/activities/shared/activity-item";
import { dealToView } from "@/components/activities/shared/activity-source";
import { sortOpenFirst } from "@/components/activities/shared/activity-rules";
import { useDealActivityList } from "@/components/activities/mark-activity-done";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// The Activities card on an organization's and a person's page: every deal
// activity linked to them, in the shared row, so they can be
// ticked, edited, deleted and traced here like anywhere else.
export function DealActivitySection({
  activities,
  loading,
  emptyHint,
}: {
  activities: Activity[];
  loading?: boolean;
  emptyHint: MessageKey;
}) {
  const { t } = useI18n();
  const today = startOfDay(new Date());
  const { source, controller, dialogs } = useDealActivityList(activities);
  const views = useMemo(() => sortOpenFirst(activities.map(dealToView)), [activities]);

  return (
    <DealSectionCard
      title={t("common.activities")}
      action={
        views.length > 0 ? (
          <span className="text-[11px] font-medium text-subtle">{views.length}</span>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-10 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      ) : views.length === 0 ? (
        <Empty className="border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks className="h-4 w-4" />
            </EmptyMedia>
            <EmptyTitle>{t("contacts.noActivities")}</EmptyTitle>
            <EmptyDescription>{t(emptyHint)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {views.map((v) => (
            <ActivityItem
              key={v.id}
              view={v}
              source={source}
              controller={controller}
              today={today}
            />
          ))}
        </ul>
      )}
      {dialogs}
    </DealSectionCard>
  );
}
