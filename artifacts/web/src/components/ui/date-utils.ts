// Local-date-safe helpers for the string <-> Date conversion the DatePicker
// does. Kept free of `@/` path aliases and React imports so they can be unit
// tested directly under the node:test runner.
//
// KTD1: the public contract is a `yyyy-mm-dd` string. We must never let a value
// round-trip through UTC (`new Date("2026-07-15")` parses as UTC midnight and
// renders the previous day in negative-offset zones). Every construct/read below
// uses the local-time Date constructor and local getters, so the calendar day
// the user picks is exactly the string we emit.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parse a `yyyy-mm-dd` string into a local-midnight Date, or `undefined`. */
export function parseYmd(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const match = YMD_RE.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  // Reject impossible dates (e.g. 2026-02-31 rolls over to March).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined
  }
  return date
}

/** Format a Date back to a `yyyy-mm-dd` string using local calendar fields. */
export function formatYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// Day-first typed input: `dd/mm/yyyy`, also tolerating `-` or `.` separators and
// a 1–2 digit day/month (e.g. `6/11/2026`). The year must be 4 digits so we only
// ever parse a fully-typed date, never a half-finished one.
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/

/** Format a Date as the `dd/mm/yyyy` string shown in the editable field. */
export function formatDmy(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = String(date.getFullYear()).padStart(4, "0")
  return `${day}/${month}/${year}`
}

/**
 * Parse a user-typed `dd/mm/yyyy` string into the canonical `yyyy-mm-dd`, or
 * `undefined` when it is incomplete or not a real calendar date. Reuses
 * `parseYmd` for the real-date check (so `31/02/2026` is rejected), keeping the
 * day-first display and the `yyyy-mm-dd` contract in one place.
 */
export function parseDmy(input: string | null | undefined): string | undefined {
  if (!input) return undefined
  const match = DMY_RE.exec(input.trim())
  if (!match) return undefined
  const day = match[1].padStart(2, "0")
  const month = match[2].padStart(2, "0")
  const ymd = `${match[3]}-${month}-${day}`
  return parseYmd(ymd) ? ymd : undefined
}

/** Convert a stored `yyyy-mm-dd` value to its `dd/mm/yyyy` display, or `""`. */
export function ymdToDmy(value: string | null | undefined): string {
  const date = parseYmd(value)
  return date ? formatDmy(date) : ""
}

/**
 * Format raw keystrokes into a `dd/mm/yyyy` mask: drop everything that isn't a
 * digit (so letters and stray punctuation never appear) and auto-insert the `/`
 * separators. A separator is added as soon as a segment fills, so typing `17`
 * shows `17/` and `1703` shows `17/03/` — the field always reads as a date.
 * Caps at 8 digits (ddmmyyyy).
 */
export function maskDmyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8)
  let out = digits.slice(0, 2)
  if (digits.length >= 2) out += "/" + digits.slice(2, 4)
  if (digits.length >= 4) out += "/" + digits.slice(4, 8)
  return out
}

/**
 * True when `date` falls outside the inclusive [min, max] bounds. Either bound
 * may be an empty/invalid string, in which case that side is unbounded. Compares
 * on the `yyyy-mm-dd` field so it is timezone-agnostic and matches the string
 * contract exactly.
 */
export function isOutOfBounds(
  date: Date,
  min?: string | null,
  max?: string | null,
): boolean {
  const value = formatYmd(date)
  const minDate = parseYmd(min)
  const maxDate = parseYmd(max)
  if (minDate && value < formatYmd(minDate)) return true
  if (maxDate && value > formatYmd(maxDate)) return true
  return false
}
