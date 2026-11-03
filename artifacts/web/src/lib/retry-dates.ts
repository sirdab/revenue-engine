// The "Try again?" dates offered after an activity is logged as no reply.
// Working days skip the weekend (Saturday and Sunday), so
// "next working day" on a Friday is Monday, not a Saturday nobody works.
// Dates are plain yyyy-MM-dd strings in the caller's local calendar, the
// same shape every activity due date uses.

export type RetryPreset = "nextWorkingDay" | "twoWorkingDays" | "inAWeek";

const WEEKEND = new Set([6, 0]); // Saturday, Sunday (Date#getDay)

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!WEEKEND.has(d.getDay())) left -= 1;
  }
  return d;
}

/** The three one-click retry dates, from `today`. "In a week" is a calendar
 *  week, then nudged off a weekend day. */
export function retryDates(today: Date): Record<RetryPreset, string> {
  const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  while (WEEKEND.has(week.getDay())) week.setDate(week.getDate() + 1);
  return {
    nextWorkingDay: ymd(addWorkingDays(today, 1)),
    twoWorkingDays: ymd(addWorkingDays(today, 2)),
    inAWeek: ymd(week),
  };
}
