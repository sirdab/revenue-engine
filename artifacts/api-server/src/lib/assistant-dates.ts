/**
 * assistant-dates.ts — shared, DB-free date handling for the Ask AI tools (fix #4).
 *
 * Validates `dateFrom`/`dateTo` tool inputs: each must be either a strict, real
 * ISO date ("2026-07-01") or a small set of symbolic periods ("today",
 * "last_month", …) resolved server-side in the app time zone (APP_TIMEZONE).
 * A garbage value fails Zod validation, and `executeTool`'s catch surfaces the
 * issue message into the `{ ok:false, message }` envelope — a recoverable
 * `is_error` the model repairs and retries, instead of a Postgres `::date` cast
 * error caught as a generic "temporarily unavailable" failure.
 *
 * This module imports NO DB module (only `zod`), so its unit tests run in the
 * normal suite with `DATABASE_URL` unset (the `assistant-*.test.ts` constraint).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// "Today" in the app time zone. Single source of truth, using
// `Intl.DateTimeFormat("en-CA", { timeZone })` (en-CA yields YYYY-MM-DD).
// assistant.ts imports `appTodayIso` from here rather than keeping its own
// copy, so there is exactly one definition of "today".
// ---------------------------------------------------------------------------

/** The IANA time zone the business runs in; calendar days are counted here. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "UTC";
const appFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE });

/** Today's calendar date in APP_TIMEZONE, as "YYYY-MM-DD". */
export function appTodayIso(now: Date = new Date()): string {
  return appFmt.format(now);
}

/**
 * Today's calendar date in APP_TIMEZONE as a UTC-midnight `Date`, for date
 * arithmetic in `resolveSymbolicRange` (UTC getters/`Date.UTC` keep the math
 * timezone-stable).
 */
export function appToday(now: Date = new Date()): Date {
  const [y, m, d] = appTodayIso(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * The APP_TIMEZONE calendar date `days` from today, as "YYYY-MM-DD" — what
 * "due in N days" means to the team. Server clocks run in UTC, whose date can
 * differ from the local one around midnight, so a UTC-derived "today" can land
 * a day off.
 */
export function appDateInDays(days: number, now: Date = new Date()): string {
  return iso(addDays(appToday(now), days));
}


function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

// ---------------------------------------------------------------------------
// Strict ISO date validation — "is it a REAL date", not just the right shape
// (rejects 2026-02-30, 2026-13-01, etc.).
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// ---------------------------------------------------------------------------
// Symbolic periods, resolved server-side so the model never does date math.
// Weeks run Sunday–Saturday.
// ---------------------------------------------------------------------------

/** Start-of-week day-of-week: 0 = Sunday, so a week runs Sun–Sat. */
const WEEK_START_DOW = 0;

export const SYMBOLIC_PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
] as const;

export type SymbolicPeriod = (typeof SYMBOLIC_PERIODS)[number];

export function resolveSymbolicRange(
  period: SymbolicPeriod,
  today: Date = appToday(),
): { dateFrom: string; dateTo: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();

  switch (period) {
    case "today":
      return { dateFrom: iso(today), dateTo: iso(today) };
    case "yesterday": {
      const d = addDays(today, -1);
      return { dateFrom: iso(d), dateTo: iso(d) };
    }
    case "this_week": {
      // Days since the most recent week-start (Sunday). `% 7` makes a Sunday
      // today resolve to a zero shift → the week starts on the same day.
      const back = (today.getUTCDay() - WEEK_START_DOW + 7) % 7;
      const start = addDays(today, -back);
      return { dateFrom: iso(start), dateTo: iso(addDays(start, 6)) };
    }
    case "last_week": {
      const back = (today.getUTCDay() - WEEK_START_DOW + 7) % 7;
      const start = addDays(addDays(today, -back), -7);
      return { dateFrom: iso(start), dateTo: iso(addDays(start, 6)) };
    }
    case "this_month":
      return {
        dateFrom: iso(new Date(Date.UTC(y, m, 1))),
        dateTo: iso(new Date(Date.UTC(y, m + 1, 0))),
      };
    case "last_month":
      return {
        dateFrom: iso(new Date(Date.UTC(y, m - 1, 1))),
        dateTo: iso(new Date(Date.UTC(y, m, 0))),
      };
    case "this_quarter": {
      const q = Math.floor(m / 3);
      return {
        dateFrom: iso(new Date(Date.UTC(y, q * 3, 1))),
        dateTo: iso(new Date(Date.UTC(y, q * 3 + 3, 0))),
      };
    }
    case "last_quarter": {
      const q = Math.floor(m / 3) - 1;
      // q can be -1 (Q1 → previous year's Q4); Date.UTC normalizes the month.
      return {
        dateFrom: iso(new Date(Date.UTC(y, q * 3, 1))),
        dateTo: iso(new Date(Date.UTC(y, q * 3 + 3, 0))),
      };
    }
    case "this_year":
      return {
        dateFrom: iso(new Date(Date.UTC(y, 0, 1))),
        dateTo: iso(new Date(Date.UTC(y, 11, 31))),
      };
    case "last_year":
      return {
        dateFrom: iso(new Date(Date.UTC(y - 1, 0, 1))),
        dateTo: iso(new Date(Date.UTC(y - 1, 11, 31))),
      };
  }
}

// ---------------------------------------------------------------------------
// The Zod schemas dropped into ListDealsInput / DealStatsInput /
// DealsMovedToStageInput. dateFrom/dateTo stay independent optional strings
// (no breaking schema change for the model); a symbolic value in either field
// resolves to the corresponding EDGE of its range ("last_month" in dateFrom →
// its first day; in dateTo → its last day). The refine message is what reaches
// the model via { ok:false, message }, so it is written to be self-correcting.
// ---------------------------------------------------------------------------

const dateErrorMessage =
  `must be a real date in YYYY-MM-DD format, or one of these symbolic periods ` +
  `(resolved in the ${APP_TIMEZONE} time zone): ${SYMBOLIC_PERIODS.join(", ")}.`;

function makeToolDateSchema(edge: "from" | "to") {
  const fieldName = edge === "from" ? "dateFrom" : "dateTo";
  return z
    .string()
    .refine(
      (v) => isRealIsoDate(v) || (SYMBOLIC_PERIODS as readonly string[]).includes(v),
      { message: `${fieldName} ${dateErrorMessage}` },
    )
    .transform((v) => {
      if (isRealIsoDate(v)) return v;
      const range = resolveSymbolicRange(v as SymbolicPeriod);
      return edge === "from" ? range.dateFrom : range.dateTo;
    })
    .optional();
}

/** For `dateFrom` fields: a symbolic value resolves to the range START. */
export const toolDateFromSchema = makeToolDateSchema("from");
/** For `dateTo` fields: a symbolic value resolves to the range END. */
export const toolDateToSchema = makeToolDateSchema("to");

/**
 * Cross-field check, applied via `.superRefine` on each input object AFTER both
 * fields are validated/transformed: reject an inverted range with a recoverable
 * message. Returns undefined when the order is fine (or either bound is absent).
 */
export function datesOrderError(
  dateFrom?: string,
  dateTo?: string,
): string | undefined {
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return `dateFrom (${dateFrom}) is after dateTo (${dateTo}) — swap them or fix the range.`;
  }
  return undefined;
}
