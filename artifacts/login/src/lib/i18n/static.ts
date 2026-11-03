// Translation without React: for plain modules (data layers, pure helpers)
// and the root error fallback, which have no component to hand a sentence
// to. Reads the active locale, which `initLocale()` sets before the first
// render and the provider keeps current. Components use `useI18n()`; this
// is the exception, not the shortcut. Kept React-free so a lib module that
// imports it can still be unit-tested under node.

import en from "./en.json";
import ar from "./ar.json";
import { getActiveLocale } from "./active-locale";
import { DEFAULT_LOCALE, LOCALE_INFO, type Locale } from "./locales";
import {
  translate,
  translatePlural,
  type Dictionary,
  type InterpolationValues,
} from "./translate";

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

/** Every key in the English dictionary, including the `key#category` plural
 *  variants. English is the source of truth for what a key IS; ar.json is
 *  checked against it by locale-parity.test.ts. */
type AnyKey = keyof typeof en;

/** Keys callable through `t()` — the plural variants are excluded so a call
 *  site can't reach one directly and skip Intl's category selection. */
export type MessageKey = Exclude<AnyKey, `${string}#${string}`>;

type BaseOf<K> = K extends `${infer B}#${string}` ? B : never;

/** Keys callable through `tPlural()`: the `key` half of any `key#category`. */
export type PluralKey = BaseOf<AnyKey>;

export function tStatic(key: MessageKey, values?: InterpolationValues): string {
  const locale = getActiveLocale();
  return translate(DICTIONARIES[locale], DICTIONARIES[DEFAULT_LOCALE], key, values);
}

export function tPluralStatic(
  key: PluralKey,
  count: number,
  values?: InterpolationValues,
): string {
  const locale = getActiveLocale();
  return translatePlural(
    DICTIONARIES[locale],
    DICTIONARIES[DEFAULT_LOCALE],
    locale,
    LOCALE_INFO[locale].tag,
    key,
    count,
    values,
  );
}
