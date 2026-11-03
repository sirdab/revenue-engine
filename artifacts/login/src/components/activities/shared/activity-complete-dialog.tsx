import { useRef, useState } from "react";
import { Check, Loader2, PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";
import { NoteField, NoteView, type NoteFieldHandle } from "./note-field";
import { appendResponse } from "./note-format";
import type { ActivitySource, ActivityView } from "./activity-source";

// The one "Did they reply?" step, asked when planned contact work (a call, a
// meeting…) is completed, on every surface. Replied needs their
// response, which is added under the existing note; No reply closes the
// attempt and hands back an open copy to reschedule. The body only reports
// the answer: what happens next (the deal flow's "what's next?" step, or
// opening the copy in the edit dialog) is the caller's.

export function ActivityCompleteBody({
  source,
  activity,
  onCancel,
  onReplied,
  onNoReply,
}: {
  source: ActivitySource;
  activity: ActivityView;
  onCancel: () => void;
  onReplied: (updated: ActivityView) => void;
  onNoReply: (copy: ActivityView) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const responseRef = useRef<NoteFieldHandle>(null);
  const [missing, setMissing] = useState(false);
  // One answer per dialog, held for the whole request: isPending lags a fast
  // double-click, and Replied then No reply must not both land.
  const answering = useRef(false);

  const replied = async () => {
    const response = responseRef.current;
    if (!response || response.isEmpty()) {
      setMissing(true);
      response?.focus();
      return;
    }
    if (answering.current) return;
    answering.current = true;
    try {
      const updated = await source.update(activity.id, {
        done: true,
        note: appendResponse(activity.note, response.read()),
      });
      toast({ title: t("activity.outcome.loggedReplied") });
      onReplied(updated);
    } catch {
      toast({ title: t("activity.outcome.failed"), variant: "destructive" });
    } finally {
      answering.current = false;
    }
  };

  const noReply = async () => {
    if (answering.current) return;
    answering.current = true;
    try {
      const { followUp } = await source.markNoReply(activity.id);
      toast({ title: t("activity.outcome.loggedNoReply") });
      onNoReply(followUp);
    } catch {
      toast({ title: t("activity.row.markNoReplyFailed"), variant: "destructive" });
    } finally {
      answering.current = false;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("activity.outcome.completeTitle")}</DialogTitle>
      </DialogHeader>
      <div className="min-w-0 space-y-2">
        <p dir="auto" className="text-sm font-medium text-foreground">
          {activity.subject}
        </p>
        {activity.note?.trim() && <NoteView note={activity.note} />}
        <p className="text-xs text-muted-foreground">{t("activity.outcome.completeHint")}</p>
        <label
          htmlFor="activity-response"
          className="block pt-1 text-xs font-medium text-muted-foreground"
        >
          {t("activity.outcome.responseLabel")}
        </label>
        <NoteField
          ref={responseRef}
          id="activity-response"
         
          autoFocus
          invalid={missing}
          placeholder={t("activity.outcome.responseLabel")}
          onChange={() => setMissing(false)}
          onSubmit={() => void replied()}
        />
        {missing && (
          <p className="text-xs text-destructive">{t("activity.outcome.responseRequired")}</p>
        )}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => void noReply()}
          disabled={source.pending}
          className="sm:me-auto"
        >
          <PhoneMissed className="me-1.5 h-4 w-4" />
          {t("activity.outcome.noReply")}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => void replied()}
          disabled={source.pending}
          className="bg-primary text-primary-foreground hover:bg-primary-hover"
        >
          {source.pending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Check className="me-1.5 h-4 w-4" />
          )}
          {t("activity.outcome.replied")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * For the DialogContent around an ActivityCompleteBody: don't let the dialog
 * place focus on open — the response field takes it, so typing straight
 * away lands in the answer, not on the editor's toolbar.
 */
export const keepFocusForField = {
  onOpenAutoFocus: (e: Event) => e.preventDefault(),
};

/** The body in its own dialog, for surfaces with no flow around it. */
export function ActivityCompleteDialog({
  source,
  activity,
  onClose,
  onNoReply,
}: {
  source: ActivitySource;
  activity: ActivityView;
  onClose: () => void;
  onNoReply: (copy: ActivityView) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        {...keepFocusForField}
        className="sm:max-w-lg"
      >
        <ActivityCompleteBody
          source={source}
          activity={activity}
          onCancel={onClose}
          onReplied={onClose}
          onNoReply={(copy) => {
            onClose();
            onNoReply(copy);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
