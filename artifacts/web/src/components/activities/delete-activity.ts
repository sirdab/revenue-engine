import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeleteActivity,
  getListActivitiesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";

// Every surface that lists activities (Activities page, deal timeline, Home
// widgets) used to reimplement its own confirm+delete+invalidate+toast flow
// (or, for most surfaces, didn't implement delete at all). This is
// the one shared implementation, mirroring why useMarkActivityDone was
// extracted the same way for the "mark done" flow.
export function useDeleteActivityWithConfirm(
  onAfter?: (activityId: number) => void,
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteActivity = useDeleteActivity();

  const remove = useCallback(
    (activity: { id: number; subject: string }) => {
      if (!window.confirm(t("activity.delete.confirm", { subject: activity.subject }))) return;
      deleteActivity
        .mutateAsync({ id: activity.id })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
          queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
          onAfter?.(activity.id);
          toast({ title: t("activity.delete.done") });
        })
        .catch(() =>
          toast({ title: t("activity.delete.failed"), variant: "destructive" }),
        );
    },
    [deleteActivity, queryClient, onAfter, toast, t],
  );

  return { remove, isPending: deleteActivity.isPending };
}
