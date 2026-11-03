import { useEffect, useRef, useState } from "react";
import { Check, Loader2, PhoneMissed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useI18n } from "@/lib/i18n/i18n";
import { formatDate } from "@/lib/format";
import { retryDates, type RetryPreset } from "@/lib/retry-dates";
import type { MessageKey } from "@/lib/i18n/i18n";
import { REPLY_OUTCOMES, type ActivityOutcome } from "./shared/activity-rules";

// The shared pieces of "log what happened / plan for later", used by every
// place a new activity is written — the deal page and the Activities page's
// "New activity" dialog — so a person learns it once. The model:
//
//   - Log what happened: pick the kind of contact, answer "Did they
//     reply?" (nothing is pre-selected, so nobody logs one by accident), and
//     for Replied write what they said. No reply needs nothing typed.
//   - Plan for later: the planned-work form each surface already had.
//   - After logging, a strip stays in the form saying what was logged —
//     a toast alone vanished before a first-time user noticed it — and after
//     No reply it offers one-click retry dates. Nothing is scheduled unless
//     one is clicked.

export type ActivityMode = "log" | "plan";

/**
 * A type name as it reads mid-sentence: "Log call", "Log site visit", but
 * "Log WhatsApp" — a name with a capital after its first letter is a proper
 * name and keeps it. Scripts without case (Arabic) pass through unchanged.
 */
export function inSentence(typeLabel: string): string {
  if (/\p{Lu}/u.test(typeLabel.slice(1))) return typeLabel;
  return typeLabel.charAt(0).toLocaleLowerCase() + typeLabel.slice(1);
}
/** What a log can be answered with: Replied / No reply. */
export type ReplyOutcome = ActivityOutcome;

const REPLY_LABEL: Record<ActivityOutcome, MessageKey> = {
  successful: "activity.outcome.replied",
  no_reply: "activity.outcome.noReply",
};

const REPLY_ICON: Record<ActivityOutcome, typeof Check> = {
  successful: Check,
  no_reply: PhoneMissed,
};

/** "Log what happened" | "Plan for later". */
export function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ActivityMode;
  onChange: (mode: ActivityMode) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      role="tablist"
      className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
    >
      {(["log", "plan"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            mode === m
              ? "bg-card text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          {t(m === "log" ? "activity.mode.log" : "activity.mode.plan")}
        </button>
      ))}
    </div>
  );
}

/** "Did they reply?" — Replied / No reply, neither chosen until clicked. */
export function ReplyChoice({
  value,
  onChange,
  disabled,
  invalid,
  showLabel = true,
}: {
  value: ReplyOutcome | null;
  onChange: (value: ReplyOutcome) => void;
  disabled?: boolean;
  /** Log was pressed with no answer chosen. */
  invalid?: boolean;
  /** Show the question above the chips (off where a dialog title asks it). */
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const option = (v: ReplyOutcome) => {
    const selected = value === v;
    const Icon = REPLY_ICON[v];
    return (
      <button
        key={v}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => onChange(v)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
          selected
            ? v === "successful"
              ? "border-teal-600 bg-teal-50 text-teal-800"
              : "border-slate-500 bg-slate-100 text-slate-800"
            : "border-slate-200 bg-card text-slate-600 hover:border-slate-300",
          invalid && !value && "border-red-300",
        )}
      >
        <Icon className="h-4 w-4" />
        {t(REPLY_LABEL[v])}
      </button>
    );
  };
  return (
    <div>
      {showLabel && (
        <p className="mb-1.5 text-xs font-medium text-slate-500">
          {t("activity.outcome.completeTitle")}
        </p>
      )}
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {REPLY_OUTCOMES.map(option)}
      </div>
      {invalid && !value && (
        <p className="mt-1 text-xs text-red-600">
          {t("activity.log.chooseReply")}
        </p>
      )}
    </div>
  );
}

export interface LoggedNotice {
  /** What was logged; drives the wording and whether a retry is offered. */
  outcome: ReplyOutcome;
  /** The translated type name, e.g. "Call". */
  typeLabel: string;
  /** Bumped per log so a second log in a row re-renders a fresh strip. */
  key: number;
}

/** The strip's headline for a log (a closed-as-no-reply follow-up aside). */
const LOGGED_TITLE: Record<ActivityOutcome, MessageKey> = {
  successful: "activity.strip.replied",
  no_reply: "activity.strip.noReply",
};

/**
 * The confirmation that stays in the form after logging. After No reply it
 * asks "Try again?" with one-click dates (working days skip the
 * weekend, see retry-dates.ts) and a date picker; `onRetry` writes the
 * planned retry and the strip then says when it is.
 */
export function LoggedStrip({
  notice,
  onRetry,
  onDismiss,
  inDialog = false,
  followUp,
}: {
  notice: LoggedNotice;
  onRetry: (dueDate: string) => Promise<void>;
  onDismiss: () => void;
  /** Shown in a popup, which has its own close button. */
  inDialog?: boolean;
  /** Planned work was closed as no reply and a follow-up copy already
   *  exists: the dates set the copy's date, "Keep as is" leaves it, and
   *  "Edit follow-up" opens it in full. */
  followUp?: { onEdit: () => void };
}) {
  const { t } = useI18n();
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Held for the whole request: a double-click must not book two retries.
  const retrying = useRef(false);
  const dates = retryDates(new Date());
  // Anything but a success (a no reply) offers a retry.
  const noReply = notice.outcome !== "successful";

  // A replied log has nothing to decide, so it clears itself; a no-reply one
  // waits for an answer (a date or "No thanks"), and a booked retry lingers
  // just long enough to read.
  useEffect(() => {
    if (noReply && !scheduledFor) return;
    const id = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(id);
  }, [noReply, scheduledFor, onDismiss]);

  const retry = async (dueDate: string) => {
    if (!dueDate || retrying.current) return;
    retrying.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onRetry(dueDate);
      setScheduledFor(dueDate);
      setPicking(false);
    } catch {
      setFailed(true);
    } finally {
      retrying.current = false;
      setBusy(false);
    }
  };

  const chip = (preset: RetryPreset, labelKey: Parameters<typeof t>[0]) => (
    <Button
      key={preset}
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void retry(dates[preset])}
      className="h-8 bg-card"
    >
      {t(labelKey)}
      <span className="ms-1.5 text-xs font-normal text-slate-400">
        {formatDate(`${dates[preset]}T00:00:00`)}
      </span>
    </Button>
  );

  return (
    <div
      role="status"
      className={cn(
        // In a popup the dialog is the frame; inline, the strip draws its own.
        !inDialog && "rounded-lg border p-3",
        !inDialog &&
          (noReply && !scheduledFor
            ? "border-slate-300 bg-slate-50"
            : "border-teal-200 bg-teal-50"),
      )}
    >
      <div className="flex items-start gap-2">
        {noReply ? (
          <PhoneMissed className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">
            {t(
              followUp
                ? "activity.strip.closedNoReply"
                : LOGGED_TITLE[notice.outcome],
              { type: notice.typeLabel },
            )}
          </p>
          {scheduledFor ? (
            <p className="mt-0.5 text-sm text-teal-700">
              {t(followUp ? "activity.strip.followUpMoved" : "activity.strip.retryScheduled", {
                date: formatDate(`${scheduledFor}T00:00:00`),
              })}
            </p>
          ) : (
            noReply && (
              <div className="mt-2 space-y-2">
                <p className="text-xs font-medium text-slate-500">
                  {t(
                    followUp
                      ? "activity.strip.followUpWhen"
                      : "activity.strip.tryAgain",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  {chip("nextWorkingDay", "activity.strip.nextWorkingDay")}
                  {chip("twoWorkingDays", "activity.strip.twoWorkingDays")}
                  {chip("inAWeek", "activity.strip.inAWeek")}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPicking((v) => !v)}
                    className="h-8 bg-card"
                  >
                    {t("activity.strip.pickDate")}
                  </Button>
                </div>
                {picking && (
                  <div className="flex flex-wrap items-center gap-2">
                    <DatePicker
                      value={pickedDate}
                      onChange={setPickedDate}
                      className="w-[170px] bg-card"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!pickedDate || busy}
                      onClick={() => void retry(pickedDate)}
                      className="h-8 bg-teal-600 text-white hover:bg-teal-700"
                    >
                      {busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                      {t("common.save")}
                    </Button>
                  </div>
                )}
                {failed && (
                  <p className="text-xs text-red-600">{t("activity.strip.retryFailed")}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {followUp && (
                    <button
                      type="button"
                      onClick={followUp.onEdit}
                      className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
                    >
                      {t("activity.strip.editFollowUp")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                  >
                    {t(followUp ? "activity.strip.keepAsIs" : "activity.strip.noThanks")}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
        {!inDialog && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("activity.strip.dismiss")}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white/60 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Briefly highlights a row that was just written, so the eye lands on what
 * the form did. Returns the class to apply while `active`.
 */
export function useFlash(activeId: number | null | undefined, id: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (activeId == null || activeId !== id) return;
    setOn(true);
    const tid = window.setTimeout(() => setOn(false), 2500);
    return () => window.clearTimeout(tid);
  }, [activeId, id]);
  return on ? "bg-teal-50/80 transition-colors duration-700" : "transition-colors duration-700";
}
