import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  useUpdateActivity,
  useCreateActivity,
  useListUserOptions,
  getListUserOptionsQueryKey,
  getListActivitiesQueryKey,
  getGetActivityHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Activity,
  ActivityType,
  UserOption as ApiUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { DueDateChips } from "@/components/activities/shared/due-date-chips";
import {
  defaultSubjectFor,
  DEFAULT_SUBJECTS,
  isContactType,
} from "@/components/activities/activity-fields";
import {
  RichNoteEditor,
  type RichNoteEditorHandle,
} from "@/components/deals/detail/rich-note-editor";
import { TypeField } from "@/components/activities/shared/type-field";
import {
  DEAL_PICKER_TYPES,
  DEAL_TYPE_OPTIONS,
} from "@/components/activities/shared/activity-source";
import {
  ActivityCompleteBody,
  keepFocusForField,
} from "@/components/activities/shared/activity-complete-dialog";
import { ActivityEditDialog } from "@/components/activities/shared/activity-edit-dialog";
import { NoReplyFollowUpDialog } from "@/components/activities/shared/no-reply-dialog";
import {
  dealToView,
  useDealActivitySource,
  type ActivitySource,
  type ActivityView,
} from "@/components/activities/shared/activity-source";
import {
  useActivityListController,
  type ActivityListController,
} from "@/components/activities/shared/activity-controller";
import { useI18n } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// Mark-an-activity-done flow with a confirmation pop-up, followed by a
// "what's next?" prompt.
//
// Completing an activity is a moment to capture what happened, so instead of a
// silent toggle, marking one done opens a dialog seeded with the activity's
// detail note (same rich editor as the composer). Confirming saves the note
// and `done: true` in a single update. Then — like other CRMs — the same
// dialog switches to a compact follow-up scheduler so a deal doesn't go quiet
// after a task is closed; the follow-up inherits the completed activity's
// deal/person/org/owner. Re-opening a done activity stays an immediate toggle —
// no dialog, no prompt.
//
// A contact activity (call, meeting, email, WhatsApp) asks "did they reply?"
// instead, with the shared ActivityCompleteBody: Replied
// saves their response under the note and continues to "what's next?"; No
// reply closes the attempt server-side and opens a copy, which is put in
// front of the person to reschedule (the caller's edit UI when it has one,
// otherwise the shared edit dialog, opened here).
//
// Exposed as a hook so every call site (deal timeline, focus panel, activities
// page, home tasks widget) shares one implementation: it returns
// `toggle(activity)` to wire to the click, and `dialog` to render once.
// ---------------------------------------------------------------------------

// The two views of the dialog: confirm the completion, then offer a follow-up.
// Holding the completed `Activity` lets the follow-up inherit its context.
type Step =
  | { kind: "done"; activity: Activity }
  | { kind: "followup"; from: Activity }
  | null;

function MarkDoneBody({
  activity,
  users,
  saving,
  onClose,
  onConfirm,
}: {
  activity: Activity;
  users: ApiUser[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<RichNoteEditorHandle>(null);

  const submit = () => {
    const html = ref.current?.isEmpty() ? "" : (ref.current?.getHTML() ?? "");
    onConfirm(html);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("activity.done.title", { subject: activity.subject })}</DialogTitle>
        <DialogDescription>
          {t("activity.done.subtitle")}
        </DialogDescription>
      </DialogHeader>
      <div className="py-1">
        <RichNoteEditor
          key={activity.id}
          ref={ref}
          users={users}
          initialHTML={activity.note ?? ""}
          onSubmit={submit}
          placeholder={t("activity.done.notePlaceholder")}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={submit}
          disabled={saving}
         
        >
          {saving ? t("common.saving") : t("activity.row.markDone")}
        </Button>
      </DialogFooter>
    </>
  );
}

function FollowUpBody({
  from,
  saving,
  onSkip,
  onSchedule,
}: {
  from: Activity;
  saving: boolean;
  onSkip: () => void;
  onSchedule: (fields: {
    subject: string;
    type: ActivityType;
    dueDate: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<ActivityType>("task");
  const [subject, setSubject] = useState(() => defaultSubjectFor("task"));
  const [dueDate, setDueDate] = useState("");

  // Swap the subject to the new type's default only while the field still holds
  // a default (empty, or a label the user hasn't typed over) — a custom subject
  // is left as written. (Mirrors the composer's type→subject behavior.)
  const changeType = (next: ActivityType) => {
    setSubject((prev) =>
      prev.trim() === "" || DEFAULT_SUBJECTS.has(prev.trim())
        ? defaultSubjectFor(next)
        : prev,
    );
    setType(next);
  };

  const canSubmit = subject.trim() !== "" && !saving;
  const submit = () => {
    if (!canSubmit) return;
    onSchedule({ subject, type, dueDate });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("activity.followUp.title")}</DialogTitle>
        <DialogDescription>
          {t(from.dealTitle ? "activity.followUp.bodyDeal" : "activity.followUp.bodyActivity")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-1">
        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-muted-foreground">{t("common.type")}</label>
          <TypeField
            options={DEAL_PICKER_TYPES.flatMap((v) => DEAL_TYPE_OPTIONS.filter((o) => o.value === v))}
            value={type}
            onChange={(v) => changeType(v as ActivityType)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-muted-foreground">{t("common.subject")}</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("activity.followUp.subjectPlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-caption font-medium text-muted-foreground">{t("common.dueDate")}</label>
          <DueDateChips value={dueDate} onChange={setDueDate} />
          {/* disablePortal: the calendar lives inside this modal Dialog, so it
              must render in-place to stay within the dialog's scroll-allowlist. */}
          <DatePicker
            className="w-44"
            value={dueDate}
            onChange={setDueDate}
            disablePortal
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onSkip} disabled={saving}>
          {t("common.skip")}
        </Button>
        <Button
          onClick={submit}
          disabled={!canSubmit}
         
        >
          {saving ? t("activity.followUp.scheduling") : t("activity.followUp.schedule")}
        </Button>
      </DialogFooter>
    </>
  );
}

function MarkActivityDoneDialog({
  step,
  users,
  source,
  marking,
  scheduling,
  onClose,
  onConfirm,
  onReplied,
  onNoReply,
  onSchedule,
}: {
  step: Step;
  users: ApiUser[];
  source: ActivitySource;
  marking: boolean;
  scheduling: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  onReplied: () => void;
  onNoReply: (copy: ActivityView) => void;
  onSchedule: (fields: {
    subject: string;
    type: ActivityType;
    dueDate: string;
  }) => void;
}) {
  return (
    <Dialog
      open={step != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        // The "Did they reply?" step's response field takes focus itself.
        {...(step?.kind === "done" && isContactType(step.activity.type)
          ? keepFocusForField
          : {})}
      >
        {step?.kind === "done" &&
          (isContactType(step.activity.type) ? (
            <ActivityCompleteBody
              key={step.activity.id}
              source={source}
              activity={dealToView(step.activity)}
              onCancel={onClose}
              onReplied={onReplied}
              onNoReply={onNoReply}
            />
          ) : (
            <MarkDoneBody
              activity={step.activity}
              users={users}
              saving={marking}
              onClose={onClose}
              onConfirm={onConfirm}
            />
          ))}
        {step?.kind === "followup" && (
          <FollowUpBody
            key={step.from.id}
            from={step.from}
            saving={scheduling}
            onSkip={onClose}
            onSchedule={onSchedule}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface MarkActivityDone {
  /** Wire to the done click. Marking done opens the dialog; un-marking toggles
   *  immediately. */
  toggle: (activity: Activity) => void;
  /** Render once in the component tree. */
  dialog: ReactNode;
}

/** @param onAfter run after any successful update (e.g. invalidate queries).
 *  Called with the completed activity's id on completion (both ids — the
 *  closed attempt and its copy — on No reply), and again with the new
 *  activity's id when a follow-up is scheduled.
 *  @param onNoReply hands the open copy a "No reply" created to the caller's
 *  own edit UI. Without it, the shared edit dialog opens on the copy here. */
export function useMarkActivityDone(
  onAfter?: (activityId: number) => void,
  onNoReply?: (copy: ActivityView) => void,
): MarkActivityDone {
  const { t } = useI18n();
  const updateActivity = useUpdateActivity();
  const createActivity = useCreateActivity();
  // The shared complete body and edit dialog write through this; it reports
  // every id it touched so the caller's queries refresh as before.
  const source = useDealActivitySource((ids) => ids.forEach((id) => onAfter?.(id)));
  // The open copy after No reply, when the caller has no edit UI of its own.
  const [copy, setCopy] = useState<ActivityView | null>(null);
  const [editingCopy, setEditingCopy] = useState(false);
  const { toast } = useToast();
  // @mention list — same query key the editors use, so this hits the cache.
  const { data: users = [] } = useListUserOptions({
    query: { queryKey: getListUserOptionsQueryKey(), staleTime: 10 * 60_000 },
  });
  const [step, setStep] = useState<Step>(null);
  // Held across a whole completion so a double-click can't close it twice.
  // (The shared complete body holds its own guard for Replied / No reply.)
  const completing = useRef(false);

  const fail = () =>
    toast({ title: t("activity.row.updateFailedPlain"), variant: "destructive" });

  const toggle = (activity: Activity) => {
    if (activity.done) {
      // Re-open: immediate, no dialog, no follow-up prompt.
      updateActivity
        .mutateAsync({ id: activity.id, data: { done: false } })
        .then(() => onAfter?.(activity.id))
        .catch(fail);
      return;
    }
    setStep({ kind: "done", activity });
  };

  const confirm = async (note: string) => {
    if (step?.kind !== "done" || completing.current) return;
    const { activity } = step;
    completing.current = true;
    try {
      // Ticking done is recorded server-side as "successful" (they replied).
      await updateActivity.mutateAsync({
        id: activity.id,
        data: { done: true, note: note || null },
      });
      onAfter?.(activity.id);
      // Prompt for the next step instead of closing.
      setStep({ kind: "followup", from: activity });
    } catch {
      fail();
    } finally {
      completing.current = false;
    }
  };

  // The shared body already saved their response and closed the attempt.
  const replied = () => {
    if (step?.kind !== "done") return;
    setStep({ kind: "followup", from: step.activity });
  };

  const noReply = (followUp: ActivityView) => {
    setStep(null);
    if (onNoReply) onNoReply(followUp);
    else setCopy(followUp);
  };

  const scheduleFollowUp = async (fields: {
    subject: string;
    type: ActivityType;
    dueDate: string;
  }) => {
    if (step?.kind !== "followup") return;
    const { from } = step;
    try {
      // Inherit the completed activity's context so the follow-up lands on the
      // same deal/person/org and stays with the same owner.
      const created = await createActivity.mutateAsync({
        data: {
          subject: fields.subject.trim(),
          type: fields.type,
          dueDate: fields.dueDate || undefined,
          dealId: from.dealId ?? undefined,
          personId: from.personId ?? undefined,
          orgId: from.orgId ?? undefined,
          ownerId: from.ownerId ?? undefined,
        },
      });
      onAfter?.(created.id);
      toast({ title: t("activity.followUp.scheduled") });
      setStep(null);
    } catch {
      toast({
        title: t("activity.followUp.scheduleFailed"),
        variant: "destructive",
      });
    }
  };

  return {
    toggle,
    dialog: (
      <>
        <MarkActivityDoneDialog
          step={step}
          users={users}
          source={source}
          marking={updateActivity.isPending}
          scheduling={createActivity.isPending}
          onClose={() => setStep(null)}
          onConfirm={confirm}
          onReplied={replied}
          onNoReply={noReply}
          onSchedule={scheduleFollowUp}
        />
        {copy && !editingCopy && (
          // The same popup every no reply ends in (shared/no-reply-dialog):
          // what happened, and when the follow-up should be.
          <NoReplyFollowUpDialog
            key={copy.id}
            source={source}
            copy={copy}
            onClose={() => setCopy(null)}
            onEdit={() => setEditingCopy(true)}
          />
        )}
        {copy && editingCopy && (
          <ActivityEditDialog
            key={copy.id}
            source={source}
            activity={copy}
            followUp
            onClose={() => {
              setCopy(null);
              setEditingCopy(false);
            }}
            onNoReply={(next) => {
              setEditingCopy(false);
              setCopy(next);
            }}
          />
        )}
      </>
    ),
  };
}

export interface DealActivityList {
  source: ActivitySource;
  controller: ActivityListController;
  /** Render once in the list: the shared edit/complete dialogs and this
   *  file's mark-done flow. */
  dialogs: ReactNode;
}

/**
 * Everything a list of deal activities needs to render shared rows
 *: a deal source, and a list controller whose tick runs this
 * file's mark-done flow (the note step and "what's next?") rather than the
 * shared default. The flow works on the full Activity, so ticks are looked
 * up by id in the list being shown.
 *
 * @param onAfter refresh after a write, per id touched. Defaults to every
 *  deal-activity list (the bare key + search, which Home, the Activities page
 *  and the org/person/deal lists all read) and that row's history.
 */
export function useDealActivityList(
  activities: readonly Activity[],
  onAfter?: (activityId: number) => void,
): DealActivityList {
  const queryClient = useQueryClient();
  const refresh = (id: number) => {
    if (onAfter) return onAfter(id);
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    queryClient.invalidateQueries({ queryKey: getGetActivityHistoryQueryKey(id) });
  };
  const source = useDealActivitySource((ids) => ids.forEach(refresh));
  const byId = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );
  // `controller` is read when a No reply lands, long after it is assigned.
  const markDone = useMarkActivityDone(refresh, (copy) => controller.openFollowUp(copy));
  const controller = useActivityListController(source, {
    toggle: (view) => {
      const activity = byId.get(view.id);
      if (activity) markDone.toggle(activity);
    },
  });
  return {
    source,
    controller,
    dialogs: (
      <>
        {controller.dialogs}
        {markDone.dialog}
      </>
    ),
  };
}
