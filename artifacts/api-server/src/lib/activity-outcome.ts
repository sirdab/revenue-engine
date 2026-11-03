import type { ActivityOutcome } from "@workspace/db";

// Replied / no reply. One set of rules so a response can't be skipped from one
// surface that another enforces.
//
//   - Logging something that already happened carries an outcome and is
//     written closed: "successful" (they replied — the response is required,
//     in the note or the subject, since some log the whole reply as a title)
//     or "no_reply" (one click, nothing to write).
//   - Ticking planned work done writes "successful"; reopening clears it.
//   - "No reply" on planned work closes the attempt and opens a copy to
//     reschedule (the /no-reply endpoint, via noReplyRefusal).
//   - Null on a done row predates outcomes. Metrics count "successful" only.
//   - Bulk "mark done" skips contact types: it has no "did they reply?" step.

/** The activity types that reach a person, and so can go unanswered. */
export const DEAL_ACTIVITY_CONTACT_TYPES = [
  "call",
  "meeting",
  "email",
  "whatsapp",
] as const;

/**
 * Why a create carrying `outcome` is invalid, or null when it is fine (or
 * carries none). Exported for tests.
 */
export function loggedOutcomeError(
  input: {
    type: string;
    outcome?: ActivityOutcome;
    note?: string | null;
    subject?: string | null;
  },
  contactTypes: readonly string[],
): string | null {
  if (input.outcome === undefined) return null;
  if (!contactTypes.includes(input.type)) {
    return "Only calls, meetings and messages can be logged as replied or no reply";
  }
  if (input.outcome === "successful" && !input.note?.trim() && !input.subject?.trim()) {
    return "Write down what they replied, in the subject or the note";
  }
  return null;
}

/** Ticking is "it went ahead"; reopening clears the answer. */
export function outcomeForDone(done: boolean): ActivityOutcome | null {
  return done ? "successful" : null;
}

/**
 * Why an activity cannot be marked no reply, or null when it can. Only open,
 * hand-written contact work can: a finished activity already has its answer,
 * and a task has nobody to reply. Exported for tests.
 */
export function noReplyRefusal(
  row: { done: boolean; type: string; draft?: boolean },
  contactTypes: readonly string[],
): string | null {
  if (row.done) return "This activity is already completed";
  if (row.draft) return "Post the draft before recording no reply";
  if (!contactTypes.includes(row.type)) {
    return "Only calls, meetings and messages can be marked as no reply";
  }
  return null;
}
