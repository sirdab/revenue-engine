import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/i18n";
import { LoggedStrip } from "@/components/activities/log-plan";
import type { ActivitySource, ActivityView } from "./activity-source";

// What every "No reply" on planned work ends in, whether it came
// from ticking the activity or from its edit dialog, on every surface: a
// popup saying the attempt was closed and asking when the follow-up — the
// copy the server already made — should be. The same popup, and the same
// date buttons, as logging a no reply from the form.
//
// It replaced reopening the edit dialog on the copy, which looked exactly
// like the dialog just used, so nothing seemed to have happened and people
// pressed No reply again.

export function NoReplyFollowUpDialog({
  source,
  copy,
  onClose,
  onEdit,
}: {
  source: ActivitySource;
  /** The open follow-up the no reply created. */
  copy: ActivityView;
  onClose: () => void;
  /** Open the follow-up in the full edit dialog. */
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const typeLabel = source.typeLabel(copy, t);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">
            {t("activity.strip.closedNoReply", { type: typeLabel })}
          </DialogTitle>
        </DialogHeader>
        <LoggedStrip
          notice={{ outcome: "no_reply", typeLabel, key: copy.id }}
          onRetry={async (dueDate) => {
            await source.update(copy.id, { dueDate });
          }}
          onDismiss={onClose}
          inDialog
          followUp={{ onEdit }}
        />
      </DialogContent>
    </Dialog>
  );
}
