import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DICTIONARIES } from "@/lib/i18n/static";
import { LOCALES } from "@/lib/i18n/locales";
import { DurationPicker } from "@/components/activities/activity-fields";
import {
  LoggedStrip,
  ModeToggle,
  ReplyChoice,
  inSentence,
  type ActivityMode,
  type LoggedNotice,
  type ReplyOutcome,
} from "@/components/activities/log-plan";
import { NoteField, type NoteFieldHandle } from "./note-field";
import { TypeField } from "./type-field";
import { LinkFields, NO_LINKS, type ActivityLinks } from "./link-fields";
import {
  defaultType,
  missingForLog,
  retryInput,
  typeAfterSwitch,
  typesFor,
  type TypeLists,
} from "./composer-rules";
import type { ActivitySource, ActivityView, CreateScope } from "./activity-source";

// The one "new activity" form, inline on a page or inside a dialog. It is
// "Log what happened / Plan for later" (see log-plan.tsx):
//
//   - Log: a contact answered with "Did they reply?" (nothing pre-selected;
//     Replied needs what they said, in the subject or the note; No reply needs
//     nothing). Written closed, now. The subject is optional.
//   - Plan: owed work with a date and time, drafts and "mark done" for tasks
//     and deadlines. The subject is pre-filled with the type's name until
//     someone types their own.
//
// After a log a strip says what was logged and, after No reply, offers the
// retry dates; in the dialog variant it replaces the form, with Done.

export interface ActivityComposerHandle {
  /** Switch to a type from outside (the deal page's Meeting / Call tabs). */
  selectType: (type: string) => void;
}

export const ActivityComposer = forwardRef<
  ActivityComposerHandle,
  {
    source: ActivitySource;
    scope: CreateScope;
    variant?: "inline" | "dialog";
    disabled?: boolean;
    /** A type each mode should start on when it offers it. */
    preferType?: string;
    /** Show the deal/person pickers (a deal activity written away from a
     *  deal page). */
    showLinks?: boolean;
    /** Every row this form writes, including retries: the list flashes it. */
    onWritten?: (activity: ActivityView) => void;
    /** Dialog variant: close the dialog. */
    onClose?: () => void;
    /** Inline variant inside a card that already frames it (the deal
     *  page): drop the form's own border and tint, keep its padding. */
    bare?: boolean;
  }
>(function ActivityComposer(
  {
    source,
    scope,
    variant = "inline",
    disabled = false,
    preferType,
    showLinks = false,
    onWritten,
    onClose,
    bare = false,
  },
  ref,
) {
  const { t } = useI18n();
  const { toast } = useToast();
  const dialog = variant === "dialog";

  // What can be picked: the source's picker types, most used first, plus
  // the caller's preferred type.
  const lists: TypeLists = useMemo(
    () => ({
      all: [
        ...source.pickerTypes,
        ...(preferType && !source.pickerTypes.includes(preferType) ? [preferType] : []),
      ],
      contact: source.contactTypes,
    }),
    [source.pickerTypes, source.contactTypes, preferType],
  );
  const labelKeyOf = (type: string) =>
    source.typeOptions.find((o) => o.value === type)?.labelKey;
  const labelOf = (type: string) => {
    const key = labelKeyOf(type);
    return key ? t(key) : type;
  };
  // Every language's name for every type, so an untouched pre-filled subject
  // is recognised (and replaced on a type change) even after a language
  // switch, and something typed is never overwritten.
  const defaultSubjects = useMemo(
    () =>
      new Set(
        source.typeOptions.flatMap((o) =>
          LOCALES.map((locale) => DICTIONARIES[locale][o.labelKey] ?? ""),
        ),
      ),
    [source.typeOptions],
  );
  const isDefaultSubject = (s: string) => !s.trim() || defaultSubjects.has(s.trim());

  // Opens on logging: the commonest thing anyone writes, and the one whose
  // Replied / No reply choice must be in plain sight.
  const [mode, setMode] = useState<ActivityMode>("log");
  const logging = mode === "log";
  const [type, setType] = useState(() => defaultType("log", lists, preferType));
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [duration, setDuration] = useState("");
  const [markDone, setMarkDone] = useState(false);
  const [links, setLinks] = useState<ActivityLinks>(NO_LINKS);
  const [reply, setReply] = useState<ReplyOutcome | null>(null);
  const [missing, setMissing] = useState<"reply" | "response" | null>(null);
  const [notice, setNotice] = useState<LoggedNotice | null>(null);
  const noteRef = useRef<NoteFieldHandle>(null);
  const lastLogged = useRef<ActivityView | null>(null);

  const contact = logging && source.contactTypes.includes(type);
  const typeLabel = labelOf(type);
  const canMarkDone =
    !logging && (type === "task" || type === "deadline");

  const chooseType = (next: string, forMode: ActivityMode = mode) => {
    setType(next);
    setMissing(null);
    // Planned work carries its type's name as a starting subject; logging
    // leaves it empty (what happened is the outcome, not the title).
    setSubject((prev) =>
      isDefaultSubject(prev) ? (forMode === "plan" ? labelOf(next) : "") : prev,
    );
  };

  useImperativeHandle(ref, () => ({ selectType: (next) => chooseType(next) }));

  const switchMode = (next: ActivityMode) => {
    setMode(next);
    setMissing(null);
    chooseType(typeAfterSwitch(type, next, lists), next);
  };

  const reset = () => {
    setSubject(logging ? "" : labelOf(type));
    setDueDate("");
    setDueTime("");
    setDuration("");
    setMarkDone(false);
    setLinks(NO_LINKS);
    setReply(null);
    setMissing(null);
    noteRef.current?.clear();
  };

  // Held for the whole write, refetch included: the button re-enabling while
  // the lists behind it were still refreshing let a second click save twice.
  const submitting = useRef(false);
  const submit = async (draft = false) => {
    if (submitting.current) return;
    const noteEmpty = noteRef.current?.isEmpty() ?? true;
    if (logging) {
      const why = missingForLog({ contact, reply, noteEmpty, subjectTyped: !isDefaultSubject(subject) });
      if (why) {
        setMissing(why);
        if (why === "response") noteRef.current?.focus();
        return;
      }
    }
    const trimmed = subject.trim() || (logging ? typeLabel : "");
    if (!trimmed) return;
    const outcome = contact ? reply! : undefined;
    submitting.current = true;
    try {
      const written = await source.create(
        {
          subject: trimmed,
          type,
          // Only Replied (or no outcome at all) has something to say;
          // anything left in the hidden field belongs to no one.
          ...((outcome === undefined || outcome === "successful") && !noteEmpty
            ? { note: noteRef.current!.read() }
            : {}),
          ...(outcome ? { outcome } : {}),
          ...(!logging && dueDate ? { dueDate } : {}),
          ...(!logging && dueTime ? { dueTime } : {}),
          ...(duration ? { duration } : {}),
          ...(canMarkDone && markDone ? { done: true } : {}),
          ...(draft ? { draft: true } : {}),
          ...(showLinks && links.dealId ? { dealId: links.dealId } : {}),
          ...(showLinks && links.personId ? { personId: links.personId } : {}),
        },
        scope,
      );
      // Anything that didn't happen (no reply) asks when to try again.
      const retryOffered = outcome !== undefined && outcome !== "successful";
      // Such a log is pointed at once its popup closes (see dismissNotice);
      // anything else straight away.
      if (!retryOffered || dialog) onWritten?.(written);
      reset();
      if (retryOffered || (outcome && dialog)) {
        // No reply needs a decision — try again, and when? — so it asks in a
        // popup that can't be missed. (An inline strip was: the row it
        // confirmed landed out of sight in the timeline, so "logged" read as
        // a claim with nothing to back it.) The row also scrolls into view
        // and flashes, via onWritten.
        lastLogged.current = written;
        setNotice({ outcome, typeLabel, key: Date.now() });
      } else if (outcome) {
        // Replied has nothing left to decide: a confirmation, and the row
        // scrolls into view and flashes.
        toast({
          title: t("activity.strip.replied", { type: typeLabel }),
        });
      } else {
        toast({
          title: draft ? t("activity.add.draftSaved") : t("activity.composer.logged"),
        });
        if (dialog) onClose?.();
      }
    } catch {
      toast({
        title: logging ? t("activity.outcome.failed") : t("activity.composer.logFailed"),
        variant: "destructive",
      });
    } finally {
      submitting.current = false;
    }
  };

  const scheduleRetry = async (retryDate: string) => {
    const from = lastLogged.current;
    if (!from) return;
    const written = await source.create(retryInput(from, retryDate), scope);
    onWritten?.(written);
  };

  const dismissNotice = useCallback(() => {
    setNotice(null);
    if (dialog) onClose?.();
    // Now that the popup is gone, bring the logged row into view.
    else if (lastLogged.current) onWritten?.(lastLogged.current);
  }, [dialog, onClose, onWritten]);

  const strip = notice && (
    <LoggedStrip
      key={notice.key}
      notice={notice}
      onRetry={scheduleRetry}
      onDismiss={dismissNotice}
      inDialog
    />
  );

  // In a dialog, a log's confirmation replaces the form: there is nothing
  // more to fill in, and Done is the way out.
  if (dialog && notice) {
    return (
      <>
        <div className="py-2">{strip}</div>
        <DialogFooter>
          <Button onClick={dismissNotice} className="bg-primary text-primary-foreground hover:bg-primary-hover">
            {t("common.done")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const submitLabel = logging
    ? t("activity.log.submit", { type: inSentence(typeLabel) })
    : t("activity.outcome.schedule");
  const busy = disabled || source.pending;

  const buttons = (
    <>
      {!logging && (
        <Button variant="outline" onClick={() => void submit(true)} disabled={busy || !subject.trim()}>
          {t("activity.add.saveDraft")}
        </Button>
      )}
      <Button
        onClick={() => void submit()}
        disabled={busy || (!logging && !subject.trim())}
        className="bg-primary text-primary-foreground hover:bg-primary-hover"
      >
        {source.pending ? (
          <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
        ) : (
          !logging && <Plus className="me-1.5 h-4 w-4" />
        )}
        {submitLabel}
      </Button>
    </>
  );

  return (
    <div
      className={cn(
        "min-w-0 space-y-3",
        !dialog && "p-4",
        !dialog && !bare && "border-b border-border bg-surface-whisper/50",
      )}
    >
      <ModeToggle mode={mode} onChange={switchMode} disabled={disabled} />
      {!dialog && notice && (
        <Dialog open onOpenChange={(open) => !open && dismissNotice()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="sr-only">
                {t("activity.strip.noReply", { type: notice.typeLabel })}
              </DialogTitle>
            </DialogHeader>
            {strip}
          </DialogContent>
        </Dialog>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">{t("common.type")}</Label>
        <TypeField
          options={typesFor(mode, lists).flatMap((v) => {
            const o = source.typeOptions.find((x) => x.value === v);
            return o ? [o] : [];
          })}
          value={type}
          onChange={(v) => chooseType(v)}
          disabled={disabled}
        />
      </div>
      <Input
        value={subject}
        disabled={disabled}
        onChange={(e) => setSubject(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !logging && void submit()}
        placeholder={
          logging
            ? t("activity.log.subjectOptional")
            : t("activity.composer.subjectPlaceholder", { type: typeLabel })
        }
        aria-label={t("common.subject")}
        className="h-9 bg-card"
      />
      {!logging && <DueDateChips value={dueDate} onChange={setDueDate} disabled={disabled} />}
      {!logging && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            className="min-w-0 bg-card sm:w-[160px]"
          />
          <TimePicker
            value={dueTime}
            onChange={setDueTime}
            className="bg-card sm:w-[130px]"
            aria-label={t("activity.composer.dueTime")}
            disablePortal={variant === "dialog"}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("activity.composer.duration")}</span>
        <DurationPicker value={duration} onChange={setDuration} />
      </div>
      {showLinks && <LinkFields value={links} onChange={setLinks} />}
      {contact && (
        <ReplyChoice
          value={reply}
          onChange={(v) => {
            setReply(v);
            setMissing(null);
          }}
          disabled={disabled}
          invalid={missing === "reply"}
        />
      )}
      {/* Mounted even while hidden: the field holds its own text, and
          flipping Replied → No reply → Replied must not lose it. No reply
          has nothing to say, so there is nothing to show. */}
      <div className={cn(contact && reply !== "successful" && "hidden")}>
        {contact && (
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("activity.outcome.responseLabel")}
          </label>
        )}
        <NoteField
          ref={noteRef}
         
          rows={2}
          invalid={missing === "response"}
          placeholder={
            contact ? t("activity.outcome.responseLabel") : t("activity.composer.notePlaceholder")
          }
          onChange={() => setMissing(null)}
          onSubmit={() => void submit()}
        />
        {missing === "response" && (
          <p className="mt-1 text-xs text-destructive">
            {t(contact ? "activity.outcome.responseOrSubjectRequired" : "activity.outcome.responseRequired")}
          </p>
        )}
      </div>
      {canMarkDone && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={markDone} onCheckedChange={(v) => setMarkDone(v === true)} />
          {t("activity.row.markDone")}
        </label>
      )}
      {dialog ? (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {buttons}
        </DialogFooter>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">{buttons}</div>
      )}
    </div>
  );
});
