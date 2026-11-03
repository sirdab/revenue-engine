import { useState } from "react";
import { Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListActivitiesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { CreateDealDialog } from "@/components/deals/create-deal-dialog";
import { AddActivityDialog } from "@/components/activities/add-activity-dialog";
import { PipelineSummaryWidget } from "@/components/home/pipeline-summary-widget";
import { TasksWidget } from "@/components/home/tasks-widget";
import { ScheduleWidget } from "@/components/home/schedule-widget";
import { RottenDealsWidget } from "@/components/home/rotten-deals-widget";
import { NotificationsWidget } from "@/components/home/notifications-widget";
import { RecentlyViewedWidget } from "@/components/home/recently-viewed-widget";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";
import { intlDateTag } from "@/lib/i18n/formatting";

const TIME_ZONE = "Asia/Riyadh";

function greetingKeyFor(now: Date): MessageKey {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: TIME_ZONE,
    }).format(now),
  );
  if (hour < 12) return "home.goodMorning";
  if (hour < 17) return "home.goodAfternoon";
  return "home.goodEvening";
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dealOpen, setDealOpen] = useState(false);
  if (!user) return null;

  const now = new Date();
  const firstName = user.name.split(" ")[0] ?? user.name;
  const dateLabel = new Intl.DateTimeFormat(intlDateTag(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: TIME_ZONE,
  }).format(now);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900">
            {t("home.greetingName", { greeting: t(greetingKeyFor(now)), name: firstName })}
          </h1>
          <p className="text-sm text-slate-500">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setDealOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" /> {t("common.deal")}
          </Button>
          <AddActivityDialog
            onCreated={() => {
              queryClient.invalidateQueries({
                queryKey: ["activities", "search"],
              });
              queryClient.invalidateQueries({
                queryKey: getListActivitiesQueryKey(),
              });
            }}
            trigger={
              <Button variant="outline">
                <Plus className="me-1.5 h-4 w-4" /> {t("common.activity")}
              </Button>
            }
          />
        </div>
      </div>

      {/* TWO PACKED COLUMNS, not row-wise auto-placement.
          The old layout placed widgets row by row — [wide, narrow] per row — so a
          tall narrow widget left a matching hole beside it. Notifications is now
          tall (it scrolls a month-end burst), which opened a screen-height gap
          under My tasks with Rotten deals stranded below it.
          Each column is its own flex stack, so both pack tight regardless of how
          tall anything gets. On mobile the wrappers stack: the day's schedule and
          alerts first, then the working widgets. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="order-2 flex flex-col gap-4 lg:order-none lg:col-span-2">
          <PipelineSummaryWidget userId={user.id} />
          <TasksWidget userId={user.id} />
          <RottenDealsWidget userId={user.id} />
          <RecentlyViewedWidget />
        </div>
        <div className="order-1 flex flex-col gap-4 lg:order-none">
          <ScheduleWidget userId={user.id} />
          <NotificationsWidget />
        </div>
      </div>

      <CreateDealDialog open={dealOpen} onOpenChange={setDealOpen} />
    </div>
  );
}
