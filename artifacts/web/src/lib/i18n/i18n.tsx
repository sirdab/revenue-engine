// The active locale: how it is resolved, how it reaches the document, and
// how components read messages out of it.
//
// It follows the same server-backed-with-a-localStorage-mirror shape as
// use-theme.ts, and for the same reason: the real value lives in
// `user_preferences` (`layout.locale`) so it follows a person across devices,
// but the document's `dir`/`lang` have to be right BEFORE React renders, and
// the server value is a network round-trip away. The mirror is the
// synchronous guess; the server is the truth.
//
// It differs from the theme in one way worth stating: there is no
// OS-preference fallback. `prefers-color-scheme` genuinely expresses what
// someone wants to look at; `Accept-Language` says what their browser was
// installed in, which is not the same thing as which language they want to
// do their job in. Unset means English until somebody chooses otherwise.

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { usePreference } from "@/hooks/use-user-preferences";
import {
  DEFAULT_LOCALE,
  LOCALE_INFO,
  isLocale,
  sanitizeLocale,
  type Locale,
} from "./locales";
import {
  lookup,
  splitTemplate,
  translate,
  translatePlural,
  type InterpolationValues,
} from "./translate";
import { DICTIONARIES, type MessageKey, type PluralKey } from "./static";

export { tStatic, tPluralStatic, type MessageKey, type PluralKey } from "./static";
import { formatDate, formatNumber } from "./formatting";
import { setActiveLocale } from "./active-locale";

const STORAGE_KEY = "crm.locale";

export interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: MessageKey, values?: InterpolationValues) => string;
  /** `t` for a message whose values include elements rather than text — an
   *  amount rendered by `<Money>`, say. Substitutes in the order the
   *  translation puts them, never the order English happens to use. */
  tNode: (key: MessageKey, values: Record<string, ReactNode>) => ReactNode;
  tPlural: (
    key: PluralKey,
    count: number,
    values?: InterpolationValues,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  setLocale: (locale: Locale) => void;
}

/** The `t` function on its own, for pure helpers that take it as an
 *  argument rather than calling the hook (they are not components). */
export type Translate = I18n["t"];
export type TranslatePlural = I18n["tPlural"];

const I18nContext = createContext<I18n | null>(null);

function storedLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Private mode / blocked site data. Falling through to the default is
    // correct: the app is still perfectly usable in English.
    return null;
  }
}

/**
 * `?lang=ar` on the current URL. The public pages link to sign-up this way, so
 * someone who read them in Arabic is not handed an English form.
 */
function requestedLocale(): Locale | null {
  try {
    const value = new URLSearchParams(window.location.search).get("lang");
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The guess used until a saved preference says otherwise: a language asked
 * for in the URL, else the one last used in this browser, else the default.
 * A signed-in person's saved preference always wins over it (I18nProvider).
 */
function guessedLocale(): Locale {
  return requestedLocale() ?? storedLocale() ?? DEFAULT_LOCALE;
}

function applyLocale(locale: Locale): void {
  const { dir, tag } = LOCALE_INFO[locale];
  document.documentElement.lang = tag;
  document.documentElement.dir = dir;
  setActiveLocale(locale);
}

/**
 * Apply the saved locale before React renders, so the first paint is already
 * the right way round. Without this an Arabic user watches the entire app
 * flip from LTR to RTL once the preferences request lands.
 */
export function initLocale(): void {
  try {
    applyLocale(guessedLocale());
  } catch {
    /* no DOM (e.g. SSR) — ignore */
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // The synchronous guess initLocale() already applied doubles as the
  // default, so there is no flicker while the server value loads.
  // (A language asked for in the URL is mirrored to storage by the effect
  // below on the first render, so it outlives the navigation that drops the
  // `?lang=` parameter.)
  const [rawLocale, setStoredLocale] = usePreference<Locale>(
    "layout.locale",
    guessedLocale(),
  );
  const locale = sanitizeLocale(rawLocale) ?? DEFAULT_LOCALE;

  useEffect(() => {
    applyLocale(locale);
    try {
      // Mirrored unconditionally, unlike the theme's mirror: there is no
      // follow-the-OS mode here, so there is no state in which a stored
      // value would be the wrong thing for initLocale() to read next time.
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Losing the mirror only costs a one-frame LTR flash on the next load.
    }
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => setStoredLocale(next),
    [setStoredLocale],
  );

  const value = useMemo<I18n>(() => {
    // Written during render, not in the effect above: the children of this
    // provider render in this same pass, and the pure helpers in
    // lib/format.ts they call read the active locale synchronously. An
    // effect would run after they had already formatted in the old one.
    setActiveLocale(locale);
    const dict = DICTIONARIES[locale];
    const fallback = DICTIONARIES[DEFAULT_LOCALE];
    const { dir, tag } = LOCALE_INFO[locale];
    return {
      locale,
      dir,
      t: (key, values) => translate(dict, fallback, key, values),
      tNode: (key, values) => {
        const template = lookup(dict, fallback, key);
        if (template === undefined) return key;
        return splitTemplate(template).map((part, i) =>
          "text" in part ? (
            part.text
          ) : (
            <Fragment key={`${part.placeholder}-${i}`}>
              {values[part.placeholder] ?? `{${part.placeholder}}`}
            </Fragment>
          ),
        );
      },
      tPlural: (key, count, values) =>
        translatePlural(dict, fallback, locale, tag, key, count, values),
      formatNumber: (v, options) => formatNumber(locale, v, options),
      formatDate: (v, options) => formatDate(locale, v, options),
      setLocale,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Messages + locale-aware formatters for the active language. */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}
