import { useCallback, useState, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";
import { ActivityEditDialog } from "./activity-edit-dialog";
import { ActivityCompleteDialog } from "./activity-complete-dialog";
import { NoReplyFollowUpDialog } from "./no-reply-dialog";
import type { ActivitySource, ActivityView } from "./activity-source";

// What a list of activities does when someone acts on a row:
// tick it, edit it, delete it — and the dialogs those open. Every list used
// to keep its own copy of this state; this is the one.
//
// The dialogs belong to the LIST, not the row, because completing or
// marking no reply moves the row to another section, which remounts it and
// would take a row-owned dialog with it. Render `dialogs` once, anywhere in
// the list.

export interface ActivityListController {
  toggle: (view: ActivityView) => void;
  edit: (view: ActivityView) => void;
  remove: (view: ActivityView) => void;
  /** After a no reply: ask when the follow-up copy should be. */
  openFollowUp: (copy: ActivityView) => void;
  /** The row just written, flashed once. */
  flashId: number | null;
  setFlashId: (id: number | null) => void;
  dialogs: ReactNode;
}

export function useActivityListController(
  source: ActivitySource,
  options: {
    /** Replaces the default tick behaviour. Deal lists pass their mark-done
     *  flow, which adds a note and a "what's next?" step. */
    toggle?: (view: ActivityView) => void;
  } = {},
): ActivityListController {
  const { t } = useI18n();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ view: ActivityView; followUp: boolean } | null>(
    null,
  );
  const [completing, setCompleting] = useState<ActivityView | null>(null);
  // The follow-up a no reply just made, asking when it should be.
  const [noReplyCopy, setNoReplyCopy] = useState<ActivityView | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);

  // Every no reply on planned work — from ticking or from editing — ends
  // here: a popup that says what happened and asks for the follow-up's date.
  const openFollowUp = useCallback((copy: ActivityView) => {
    setEditing(null);
    setNoReplyCopy(copy);
  }, []);

  const setDone = async (view: ActivityView, done: boolean) => {
    try {
      await source.update(view.id, { done });
    } catch {
      toast({ title: t("activity.row.updateFailed"), variant: "destructive" });
    }
  };

  // Reopening is one click. Completing planned contact work asks "Did they
  // reply?"; completing anything else is one click.
  const defaultToggle = (view: ActivityView) => {
    if (view.done) return void setDone(view, false);
    if (source.contactTypes.includes(view.type)) return setCompleting(view);
    void setDone(view, true);
  };

  const remove = (view: ActivityView) => {
    if (!window.confirm(t("activity.delete.confirm", { subject: view.subject }))) return;
    source
      .remove(view)
      .then(() => toast({ title: t("activity.delete.done") }))
      .catch(() => toast({ title: t("activity.delete.failed"), variant: "destructive" }));
  };

  const dialogs = (
    <>
      {editing && (
        <ActivityEditDialog
          // Keyed so the form re-initialises from the copy.
          key={editing.view.id}
          source={source}
          activity={editing.view}
          followUp={editing.followUp}
          onClose={() => setEditing(null)}
          onNoReply={openFollowUp}
        />
      )}
      {noReplyCopy && (
        <NoReplyFollowUpDialog
          key={noReplyCopy.id}
          source={source}
          copy={noReplyCopy}
          onClose={() => {
            // Point at where the follow-up went.
            setFlashId(noReplyCopy.id);
            setNoReplyCopy(null);
          }}
          onEdit={() => {
            setEditing({ view: noReplyCopy, followUp: true });
            setNoReplyCopy(null);
          }}
        />
      )}
      {completing && (
        <ActivityCompleteDialog
          key={completing.id}
          source={source}
          activity={completing}
          onClose={() => setCompleting(null)}
          onNoReply={openFollowUp}
        />
      )}
    </>
  );

  return {
    toggle: options.toggle ?? defaultToggle,
    edit: (view) => setEditing({ view, followUp: false }),
    remove,
    openFollowUp,
    flashId,
    setFlashId,
    dialogs,
  };
}
