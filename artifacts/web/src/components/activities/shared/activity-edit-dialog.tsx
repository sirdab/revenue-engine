import { useRef, useState } from "react";
import { Loader2, PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { DueDateChips } from "./due-date-chips";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n/i18n";
import { DurationPicker } from "@/components/activities/activity-fields";
import { LinkFields } from "./link-fields";
import { TypeField } from "./type-field";
import { NoteField, type NoteFieldHandle } from "./note-field";
import { canMarkNoReply } from "./note-format";
import type { ActivitySource, ActivityView } from "./activity-source";

// The one "edit activity" dialog: subject, type, schedule, deal
// and person links and a rich-text note. "No reply" appears on exactly the
// activities the server accepts it for (canMarkNoReply).
//
// Render it from the LIST, not the row: "No reply" moves the row it was
// opened from out of the open section, which remounts it, so a row-owned
// dialog would close itself the moment the follow-up it hands back appears.

export function ActivityEditDialog({
  source,
  activity,
  followUp = false,
  onClose,
  onNoReply,
}: {
  source: ActivitySource;
  activity: ActivityView;
  /** This is the open copy that replaced an attempt closed as no reply. */
  followUp?: boolean;
  onClose: () => void;
  /** After "No reply": the open copy, for the caller to put in front of the
   *  person to reschedule (typically this same dialog, `followUp`). */
  onNoReply: (copy: ActivityView) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const noteRef = useRef<NoteFieldHandle>(null);
  const [form, setForm] = useState({
    subject: activity.subject,
    type: activity.type,
    dueDate: activity.dueDate ?? "",
    dueTime: activity.dueTime ?? "",
    duration: activity.duration ?? "",
    dealId: activity.links?.deal?.id ?? null,
    dealLabel: activity.links?.deal?.label ?? null,
    personId: activity.links?.person?.id ?? null,
    personLabel: activity.links?.person?.label ?? null,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const offerNoReply = canMarkNoReply(activity, source.contactTypes);
  // Held for the whole request: isPending lags a fast double-click.
  const busy = useRef(false);

  const save = async () => {
    const subject = form.subject.trim();
    if (!subject || busy.current) return;
    busy.current = true;
    const note = noteRef.current;
    try {
      await source.update(activity.id, {
        subject,
        type: form.type,
        dueDate: form.dueDate || null,
        dueTime: form.dueTime || null,
        duration: form.duration || null,
        // The rich editor rewrites legacy markup on load, so an untouched
        // note is left out rather than resaved as a spurious change.
        ...(note?.isDirty() ? { note: note.read() || null } : {}),
        dealId: form.dealId,
        personId: form.personId,
      });
      onClose();
    } catch {
      toast({ title: t("activity.row.updateFailed"), variant: "destructive" });
    } finally {
      busy.current = false;
    }
  };

  // Closes this attempt as it stands — unsaved edits are discarded, because
  // they describe the attempt that just failed, not the next one — and hands
  // the open copy back to be rescheduled.
  const noReply = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { followUp: copy } = await source.markNoReply(activity.id);
      onNoReply(copy);
    } catch {
      toast({ title: t("activity.row.markNoReplyFailed"), variant: "destructive" });
    } finally {
      busy.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {followUp ? t("activity.row.followUpTitle") : t("activity.row.editTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="activity-edit-subject">{t("common.subject")}</Label>
            <Input
              id="activity-edit-subject"
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("common.type")}</Label>
            <TypeField
              // The picker types, plus this activity's own type if it is one
              // no longer offered (an old deadline stays a deadline).
              options={source.typeOptions.filter(
                (o) => source.pickerTypes.includes(o.value) || o.value === activity.type,
              )}
              value={form.type}
              onChange={(v) => set("type", v)}
            />
          </div>
          {/* Date and time share a row from tablet width up; on a phone they
              stack, because a native time input needs its full width. */}
          <DueDateChips value={form.dueDate} onChange={(next) => set("dueDate", next)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <DatePicker
              value={form.dueDate}
              onChange={(next) => set("dueDate", next)}
              className="min-w-0 sm:flex-1"
            />
            <TimePicker
              value={form.dueTime}
              onChange={(next) => set("dueTime", next)}
              className="sm:w-[130px] sm:shrink-0"
              aria-label={t("activity.composer.dueTime")}
              disablePortal
            />
          </div>
          <div>
            <span className="mb-1 block text-caption font-medium text-muted-foreground">
              {t("activity.composer.duration")}
            </span>
            <DurationPicker value={form.duration} onChange={(d) => set("duration", d)} />
          </div>
          <LinkFields
            value={{
              dealId: form.dealId,
              dealLabel: form.dealLabel,
              personId: form.personId,
              personLabel: form.personLabel,
            }}
            onChange={(l) => setForm((f) => ({ ...f, ...l }))}
          />
          <NoteField
            ref={noteRef}
            initial={activity.note}
            placeholder={t("activity.row.notePlaceholder")}
            onSubmit={() => void save()}
          />
        </div>
        <DialogFooter>
          {offerNoReply && (
            <Button
              variant="outline"
              onClick={() => void noReply()}
              disabled={source.pending}
              title={t("activity.row.markNoReplyHint")}
              className="sm:me-auto"
            >
              <PhoneMissed className="me-1.5 h-4 w-4" />
              {t("activity.row.markNoReply")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!form.subject.trim() || source.pending}
          >
            {source.pending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
