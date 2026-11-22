// Shared formatting helpers for the Deals workspace and, by now, everything
// else that shows an amount or a timestamp.
//
// Currency renders Pipedrive-style with the code glued to the amount and no
// decimals (e.g. "USD132,000"). Date/time is rendered in the signed-in user's
// timezone with a long month, e.g. "October 22, 2023 1:51 PM".
//
// These are plain functions, not hooks, and are called from dozens of files.
// They follow the active UI language through `getActiveLocale()`:
// the English output is byte-for-byte what it was before the app spoke
// Arabic, and the Arabic output goes through the same Intl formatters the
// i18n provider uses, with the same digit and calendar pins.

import { getActiveLocale } from "@/lib/i18n/active-locale";
import {
  formatNumber as intlNumber,
  intlDateTag,
  relativeTimeFormat,
} from "@/lib/i18n/formatting";
import type { Locale } from "@/lib/i18n/locales";

// The workspace's display defaults (Settings › Workspace): the currency for
// an amount that names none, the time zone for every timestamp, and the first
// day of the week. Same pattern as the active locale (see
// i18n/active-locale.ts): the auth provider writes them once the user is
// known, and these plain helpers read them.
let defaultCurrency = "USD";
let timeZone = "UTC";
let weekStart: 0 | 1 | 6 = 1;

export function setDisplayDefaults(defaults: {
  currency?: string;
  timeZone?: string;
  weekStart?: number;
}): void {
  if (defaults.currency) defaultCurrency = defaults.currency.toUpperCase();
  if (defaults.timeZone && isValidTimeZone(defaults.timeZone)) timeZone = defaults.timeZone;
  if (defaults.weekStart === 0 || defaults.weekStart === 1 || defaults.weekStart === 6) {
    weekStart = defaults.weekStart;
  }
}

/** First day of the week: 0 Sunday, 1 Monday, 6 Saturday. */
export function getWeekStart(): 0 | 1 | 6 {
  return weekStart;
}

/** The currency an amount is shown in when the record names none. */
export function getDefaultCurrency(): string {
  return defaultCurrency;
}

/** The IANA zone timestamps are shown in. */
export function getDisplayTimeZone(): string {
  return timeZone;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function formatCurrency(
  value: number | null | undefined,
  currency: string = defaultCurrency,
): string {
  const locale = getActiveLocale();
  if (locale === "en") {
    const amount = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(value ?? 0);
    return `${currency}${amount}`;
  }
  return intlNumber(locale, value ?? 0, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return intlNumber(getActiveLocale(), value);
}

/**
 * A number short enough for a chart axis tick: "1.2M", "850K".
 *
 * Compact notation through the same locale-aware formatter as everything else,
 * so Arabic gets Arabic abbreviations and the digit pin still applies. Axis
 * ticks are the one place a rounded number is right — the exact figure is in
 * the hover tooltip beside it.
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return intlNumber(getActiveLocale(), value, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let formatter = dateCache.get(key);
  if (!formatter) {
    // en-US rather than the bare `en` tag so the English output is exactly
    // what `toLocaleDateString("en-US", …)` produced before.
    const tag = locale === "en" ? "en-US" : intlDateTag(locale);
    formatter = new Intl.DateTimeFormat(tag, { ...options, timeZone });
    dateCache.set(key, formatter);
  }
  return formatter;
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
};
const TIME: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormat(getActiveLocale(), LONG_DATE).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const locale = getActiveLocale();
  const date = dateFormat(locale, LONG_DATE).format(d);
  const time = dateFormat(locale, TIME).format(d);
  return `${date} ${time}`;
}

/** "Oct 22, 2023" — the short-month date the lists use. Replaces
 *  date-fns' `format(d, "MMM d, yyyy")`, which only speaks English.
 *  Takes a Date so a `yyyy-mm-dd` string parsed with parseISO stays on
 *  the calendar day it names; no timezone is applied. */
export function formatShortDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return calendarFormat(getActiveLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** "Oct 22" — `formatShortDate` without the year. */
export function formatMonthDay(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return calendarFormat(getActiveLocale(), { month: "short", day: "numeric" }).format(d);
}

/** "Oct" — the month alone, for an axis whose bars are all one year. */
export function formatMonthShort(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return calendarFormat(getActiveLocale(), { month: "short" }).format(d);
}

/** "Oct 2023". */
export function formatMonthYear(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return calendarFormat(getActiveLocale(), { month: "short", year: "numeric" }).format(d);
}

const calendarCache = new Map<string, Intl.DateTimeFormat>();

// Like dateFormat but in the browser's own zone rather than the user's: these
// render calendar dates (due dates, join dates) that were parsed as local
// midnight, and shifting them by a zone offset would move the day.
function calendarFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = calendarCache.get(key);
  if (!formatter) {
    const tag = locale === "en" ? "en-US" : intlDateTag(locale);
    formatter = new Intl.DateTimeFormat(tag, options);
    calendarCache.set(key, formatter);
  }
  return formatter;
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Exact wall-clock time in the user's timezone, e.g. "Jul 7, 2026, 2:34 PM". */
export function formatExactTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  return dateFormat(getActiveLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...TIME,
  }).format(d);
}

const REL_UNITS: [
  limit: number,
  secs: number,
  suffix: string,
  unit: Intl.RelativeTimeFormatUnit,
][] = [
  [45 * 60, 60, "m", "minute"],
  [24 * 3600, 3600, "h", "hour"],
  [7 * 86400, 86400, "d", "day"],
  [30 * 86400, 7 * 86400, "w", "week"],
  [365 * 86400, 30 * 86400, "mo", "month"],
  [Infinity, 365 * 86400, "y", "year"],
];

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "1d ago",
 *  "2w ago", "in 3d" (future). Returns "" for invalid input.
 *
 *  English keeps its hand-rolled one-letter units, which are shorter than
 *  anything Intl offers and are what the timelines were designed around.
 *  Other languages go through `Intl.RelativeTimeFormat`, because "5m" is
 *  not an abbreviation Arabic has. */
export function formatRelativeShort(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const locale = getActiveLocale();
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 45) return locale === "en" ? "just now" : JUST_NOW[locale];
  const future = diffMs > 0;
  for (const [limit, secs, suffix, unit] of REL_UNITS) {
    if (absSec < limit) {
      const n = Math.max(1, Math.round(absSec / secs));
      if (locale === "en") {
        const label = `${n}${suffix}`;
        return future ? `in ${label}` : `${label} ago`;
      }
      return relativeTimeFormat(locale, {
        numeric: "always",
        style: "short",
      }).format(future ? n : -n, unit);
    }
  }
  return "";
}

/** Long relative time in the active language, e.g. "2 hours ago", "in 3 days",
 *  "قبل ساعتين". Replaces date-fns' English-only formatDistanceToNow. */
export function formatRelativeLong(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "";
  const locale = getActiveLocale();
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 45) return locale === "en" ? "just now" : JUST_NOW[locale];
  const future = diffMs > 0;
  for (const [limit, secs, , unit] of REL_UNITS) {
    if (absSec < limit) {
      const n = Math.max(1, Math.round(absSec / secs));
      return relativeTimeFormat(locale, { numeric: "always", style: "long" }).format(
        future ? n : -n,
        unit,
      );
    }
  }
  return "";
}

// "just now" has no Intl equivalent; one word per non-English locale.
const JUST_NOW: Record<Exclude<Locale, "en">, string> = { ar: "الآن" };

/** Exact time with a compact relative hint in brackets, e.g.
 *  "Jul 7, 2026, 2:34 PM (1d ago)". This is the app-wide standard for
 *  timestamped events (timelines, notes, activities, history). */
export function formatTimestamp(value: DateInput): string {
  const d = toDate(value);
  if (!d) return "—";
  const rel = formatRelativeShort(d);
  const exact = formatExactTime(d);
  return rel ? `${exact} (${rel})` : exact;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}
