import { useBulkUpdateActivities } from "@workspace/api-client-react";
import type { ActivityBulkInput } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { X, Trash2, Loader2, CheckCircle2, Circle } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n";

// Floating action bar shown while table rows are selected — the activities
// counterpart of DealsBulkBar. Unlike the single-item mark-done flow there is
// no capture-details dialog: bulk just flips the done state.
export function ActivitiesBulkBar({
  selectedIds,
  onDone,
  onClear,
}: {
  selectedIds: number[];
  /** Called after a successful action, before the selection is cleared —
   *  refresh the activity caches here. */
  onDone: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const bulk = useBulkUpdateActivities();
  const { toast } = useToast();

  const run = async (
    action: ActivityBulkInput["action"],
    successVerb: string,
  ) => {
    try {
      const res = await bulk.mutateAsync({
        data: { ids: selectedIds, action },
      });
      onDone();
      toast({
        title: `${successVerb} ${res.updatedCount} ${res.updatedCount === 1 ? "activity" : "activities"}`,
        // mark_done/mark_open skip rows already in the target state, so the
        // count can be lower than the selection — that's expected. Bulk
        // completion also skips calls, meetings, emails and WhatsApp (each
        // has to answer "did they reply?"), and says so when it happened.
        ...(action === "mark_done" && res.updatedCount < selectedIds.length
          ? { description: t("activity.bulk.contactSkipped") }
          : {}),
      });
      onClear();
    } catch {
      toast({ title: t("activity.bulk.failed"), variant: "destructive" });
    }
  };

  return (
    <div className="fixed bottom-6 start-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-popover px-4 py-2.5 shadow-popover-sm backdrop-blur-popover">
      <span className="text-body font-medium text-foreground">
        {selectedIds.length} selected
      </span>
      <div className="h-5 w-px bg-gray-200" />

      <Button
        variant="outline"
        size="sm"
        disabled={bulk.isPending}
        onClick={() => run("mark_done", t("activity.bulk.completed"))}
      >
        <CheckCircle2 className="me-1.5 h-4 w-4" />
        {t("activity.bulk.markComplete")}
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={bulk.isPending}
        onClick={() => run("mark_open", t("activity.bulk.reopened"))}
      >
        <Circle className="me-1.5 h-4 w-4" />
        {t("activity.bulk.reopen")}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={bulk.isPending}
            className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
          >
            <Trash2 className="me-1.5 h-4 w-4" />
            {t("common.delete")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common.delete")} {selectedIds.length}{" "}
              {selectedIds.length === 1 ? "activity" : "activities"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("activity.bulk.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive"
              onClick={() => run("delete", t("activity.bulk.deleted"))}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {bulk.isPending && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        onClick={onClear}
        aria-label={t("activity.bulk.clearSelection")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
