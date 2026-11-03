import { useState } from "react";
import {
  useListActivities,
  usePostActivity,
  useDeleteActivity,
  getListActivitiesQueryKey,
} from "@workspace/api-client-react";
import type { Activity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/deals/detail/rich-text";
import { STATUS_PILL_CLASS } from "@/components/activities/activity-status";
import { ACTIVITY_TYPE_CONFIG } from "@/components/activities/activity-fields";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// The user's unpublished activity drafts, surfaced on the activities page so
// they're reachable outside a deal timeline. `draftsOnly` returns
// exactly the caller's own drafts — other users' drafts are never returned, and
// crucially they aren't buried under the posted-activity window (a plain
// includeDrafts list is capped at 500 rows, so a draft can fall outside it).
// No-deal drafts would otherwise be invisible, since the activities search
// excludes drafts.
export function ActivityDraftsSection({
  onChanged,
}: {
  // Refresh the page's search cache after a draft is posted/discarded.
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { data: drafts = [] } = useListActivities(
    { draftsOnly: true },
    {
      query: {
        queryKey: getListActivitiesQueryKey({ draftsOnly: true }),
      },
    },
  );

  const postActivity = usePostActivity();
  const deleteActivity = useDeleteActivity();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Which draft has a post/discard in flight, so only its row is disabled.
  const [pendingId, setPendingId] = useState<number | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListActivitiesQueryKey({ draftsOnly: true }),
    });
    onChanged();
  };

  const post = async (a: Activity) => {
    setPendingId(a.id);
    try {
      await postActivity.mutateAsync({ id: a.id });
      refresh();
      toast({ title: t("activity.drafts.posted") });
    } catch {
      toast({ title: t("activity.drafts.postFailed"), variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  const discard = async (a: Activity) => {
    if (!window.confirm(t("activity.drafts.discardConfirm")))
      return;
    setPendingId(a.id);
    try {
      await deleteActivity.mutateAsync({ id: a.id });
      refresh();
      toast({ title: t("activity.drafts.discarded") });
    } catch {
      toast({ title: t("activity.drafts.discardFailed"), variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  if (drafts.length === 0) return null;

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
        <span className="h-2 w-2 rounded-full bg-warning" />
        {t("activity.drafts.title")}
        <span className="text-subtle">· {drafts.length}</span>
      </div>
      {/* On desktop the Activities page is a fixed-height view, so a pile of
          drafts must not squeeze the table/board/agenda below it:
          the list scrolls inside the section, the header stays put. Phones
          scroll the whole page instead, so they aren't capped. */}
      <div className="space-y-2 md:max-h-[25vh] md:overflow-auto">
        {drafts.map((a) => {
          const meta = [a.dealTitle, a.personName].filter(Boolean).join(" · ");
          const mutating = pendingId === a.id;
          const TypeIcon = ACTIVITY_TYPE_CONFIG[a.type].Icon;
          return (
            <div
              key={a.id}
              className="rounded-lg border border-dashed border-warning/30 bg-warning-subtle/40 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <TypeIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {a.subject}
                  </span>
                  <span
                    className={cn(
                      STATUS_PILL_CLASS,
                      "border-warning/30 bg-warning-subtle text-warning",
                    )}
                  >
                    {t("common.draft")}
                  </span>
                  {meta && (
                    <span className="truncate text-[11px] text-subtle">
                      · {meta}
                    </span>
                  )}
                </div>
                <time className="shrink-0 text-[11px] text-subtle">
                  {formatTimestamp(a.addTime)}
                </time>
              </div>
              {a.note && (
                <RichText
                  html={a.note}
                  className="mt-1 break-words text-sm text-muted-foreground"
                />
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => discard(a)}
                  disabled={mutating}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {t("common.discard")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => post(a)}
                  disabled={mutating}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover"
                >
                  {mutating ? t("activity.drafts.posting") : t("activity.drafts.post")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
