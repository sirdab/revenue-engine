import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  format,
  isValid,
  parseISO,
} from "date-fns";

// ---------------------------------------------------------------------------
// Date-bucket math shared by the chart shaper (gap filling) and the
// drill-through URL builder (bucket → date range). ONE definition of how wide
// a bucket is — if these drifted, a click on a bar could open a deals list
// that doesn't match the bar.
// ---------------------------------------------------------------------------

export type DateBucket = "day" | "week" | "month" | "quarter";

export const BUCKET_STEP: Record<DateBucket, (d: Date) => Date> = {
  day: (d) => addDays(d, 1),
  week: (d) => addWeeks(d, 1),
  month: (d) => addMonths(d, 1),
  quarter: (d) => addQuarters(d, 1),
};

export function isDateBucket(v: unknown): v is DateBucket {
  return v === "day" || v === "week" || v === "month" || v === "quarter";
}

/** Parse a query-result x that looks like an ISO date; null otherwise. */
export function parseDateX(x: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(x)) return null;
  const d = parseISO(x.slice(0, 10));
  return isValid(d) ? d : null;
}

/** ISO yyyy-mm-dd out of whatever the (Date-or-string typed) API carries. */
export function isoDay(v: unknown): string | null {
  if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
  if (v instanceof Date && isValid(v)) return format(v, "yyyy-MM-dd");
  return null;
}
