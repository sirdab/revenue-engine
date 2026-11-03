// The set of UI languages, and the facts about each one that the rest of the
// app needs before any message has been looked up (direction, the name to
// show in the switcher). Kept free of the message dictionaries so that
// `initLocale()` can run before React — and before either JSON bundle has
// been parsed — with nothing but this module loaded.

export const LOCALES = ["en", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleInfo {
  /** Shown in the language switcher, in the language itself — a person
   *  looking for Arabic is looking for "العربية", not for "Arabic". */
  nativeName: string;
  /** Shown to English readers (e.g. in an admin list) and in `title`. */
  englishName: string;
  dir: "ltr" | "rtl";
  /** BCP-47 tag for Intl (number/date formatting, plural rules). */
  tag: string;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { nativeName: "English", englishName: "English", dir: "ltr", tag: "en" },
  // ar-SA rather than bare `ar`: the region decides the calendar and the
  // default numbering system Intl reaches for, and this app is used in Saudi.
  // Digits are pinned separately (see formatting.ts) and deliberately do not
  // ride on this tag.
  ar: { nativeName: "العربية", englishName: "Arabic", dir: "rtl", tag: "ar-SA" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Validates a resolved `layout.locale` preference value. Mirrors
 * `sanitizeTheme` in ../preferences.ts and exists for the same reason:
 * respondWithPreferences falls back to the raw stored document when it fails
 * schema validation, so the client can in principle receive a garbage value
 * at this path.
 */
export function sanitizeLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}
