// Locale-aware number, currency and date formatting.
//
// THE DIGIT DECISION LIVES HERE. Arabic can render numbers in Arabic-Indic
// digits (٢٠٢٥) or Latin ones (2025); `ar-SA` defaults to Arabic-Indic. We
// pin Latin for now, because amounts and reference numbers are read against
// documents (invoices, bank statements) that are in Latin digits, and a
// mismatch there is a transcription error waiting to happen. To follow the
// locale instead, flip the one constant below and nothing else.

import { LOCALE_INFO, type Locale } from "./locales";

/** `latn` = Latin digits. Set to `null` to follow the locale's own default
 *  (Arabic-Indic for ar-SA). One switch, deliberately. */
const NUMBERING_SYSTEM: string | null = "latn";

/** The BCP-47 tag Intl should be given for `locale`, digits included. */
export function intlTag(locale: Locale): string {
  const base = LOCALE_INFO[locale].tag;
  return NUMBERING_SYSTEM ? `${base}-u-nu-${NUMBERING_SYSTEM}` : base;
}

/** `intlTag` plus the calendar pin — see `dateFormat` for why. A BCP-47
 *  tag carries ONE `-u-` extension sequence with every keyword inside it;
 *  `…-u-nu-latn-u-ca-gregory` is a RangeError, not a second extension. */
export function intlDateTag(locale: Locale): string {
  const tag = intlTag(locale);
  return tag.includes("-u-") ? `${tag}-ca-gregory` : `${tag}-u-ca-gregory`;
}

// Intl formatters are expensive to construct and are the usual reason a
// table of a few hundred rows feels slow, so each distinct shape is built
// once and reused.
const numberCache = new Map<string, Intl.NumberFormat>();

function numberFormat(
  locale: Locale,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlTag(locale), options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormat(locale, options ?? {}).format(value);
}

const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateCache.get(key);
  if (!formatter) {
    // `ar-SA` would otherwise format dates in the Islamic (Hijri) calendar,
    // which is correct for that locale and wrong for this app: every due date
    // and timestamp it would be compared against is Gregorian. Pinned rather than left to the tag's default.
    formatter = new Intl.DateTimeFormat(intlDateTag(locale), options);
    dateCache.set(key, formatter);
  }
  return formatter;
}

export function formatDate(
  locale: Locale,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormat(
    locale,
    options ?? { day: "numeric", month: "short", year: "numeric" },
  ).format(date);
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

/** A cached `Intl.RelativeTimeFormat` for `locale`, digits pinned like the
 *  rest. Used by `lib/format.ts` for the compact "5m ago" style. */
export function relativeTimeFormat(
  locale: Locale,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = relativeCache.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(intlTag(locale), options);
    relativeCache.set(key, formatter);
  }
  return formatter;
}
