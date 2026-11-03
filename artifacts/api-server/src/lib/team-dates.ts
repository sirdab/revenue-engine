// The team's calendar day. Server clocks run in UTC, whose date lags a
// UTC+3 team's between 00:00 and 03:00 local, so "due in N days" is counted
// from the team's own date, not UTC's.
//
// The team timezone is Asia/Riyadh, the same zone the deal filters and
// insights use for date truncation.

const TEAM_TZ = "Asia/Riyadh";
const teamFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TZ });

/** Today's calendar date in the team's timezone, as "YYYY-MM-DD". */
export function teamTodayIso(now: Date = new Date()): string {
  return teamFmt.format(now);
}

/** The team calendar date `days` from today, as "YYYY-MM-DD". */
export function teamDateInDays(days: number, now: Date = new Date()): string {
  const [y, m, d] = teamTodayIso(now).split("-").map(Number);
  const out = new Date(Date.UTC(y, m - 1, d));
  out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString().slice(0, 10);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A strict YYYY-MM-DD string naming a real calendar date (no 2026-02-30). */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}
