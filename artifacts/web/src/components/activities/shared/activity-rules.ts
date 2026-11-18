import type { ActivityStatus } from "../activity-status";

// How an activity reads, decided once for every surface. Five
// status derivations used to live beside five different rows; they now all
// come from here. Plain .ts so node:test can run it.

/** How a completed activity went: "did they reply?". */
export type ActivityOutcome = "successful" | "no_reply";

/** The answers every contact activity can have. */
export const REPLY_OUTCOMES = ["successful", "no_reply"] as const satisfies readonly ActivityOutcome[];

/**
 * Closed without the thing having happened (no reply). Shown with the grey
 * missed mark rather than the teal check, so a failed attempt never reads as
 * completed work.
 */
export function closedUnsuccessful(a: {
  done: boolean;
  outcome?: ActivityOutcome | null;
}): boolean {
  return a.done && a.outcome != null && a.outcome !== "successful";
}

type StatusInput = {
  done: boolean;
  outcome?: ActivityOutcome | null;
  /** yyyy-MM-dd */
  dueDate: string | null;
};

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Upcoming until done, Today on its due date, Overdue from the next day,
 * Done when completed — or No reply when it was closed unanswered.
 *
 * Overdue is by DATE, not time, on purpose (decided 2026-09-30): a call due
 * at 10:00 reads "Today" all day, which is also how the server counts the
 * Activities page's overdue/today tiles, so a row and its tile never
 * disagree.
 */
export function statusOf(a: StatusInput, today: Date): ActivityStatus {
  if (a.done) return a.outcome === "no_reply" ? "noReply" : "done";
  if (a.dueDate) {
    const t = ymd(today);
    if (a.dueDate < t) return "overdue";
    if (a.dueDate === t) return "today";
  }
  return "planned";
}

export type Bucket = "overdue" | "today" | "upcoming" | "done";

/** The Activities page's four tiles, from the same status. */
export function bucketOf(a: StatusInput, today: Date): Bucket {
  const s = statusOf(a, today);
  if (s === "overdue" || s === "today") return s;
  if (s === "planned") return "upcoming";
  // Every closed status — done and no reply.
  return "done";
}

/**
 * Open first, soonest due at the top (undated last); then done, most
 * recently completed first. The order every activity list uses.
 */
export function sortOpenFirst<
  T extends { done: boolean; dueDate: string | null; markedAsDoneTime?: string | null },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) {
      if (a.dueDate === b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return (b.markedAsDoneTime ?? "").localeCompare(a.markedAsDoneTime ?? "");
  });
}
