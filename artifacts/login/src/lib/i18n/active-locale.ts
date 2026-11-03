// The locale in force right now, readable from plain modules.
//
// Components read the locale from `useI18n()`. Pure helpers — `lib/format.ts`
// most of all, called from dozens of files that predate i18n — cannot call a
// hook, and threading a locale argument through every one of those call
// sites would be the largest and least interesting diff in the project. So
// the provider writes the active locale here whenever it changes, and the
// helpers read it. It is written in `applyLocale()` alongside the document's
// `lang`/`dir`, which is the moment the locale becomes true for everything.
//
// The provider re-keys the routed tree on a locale change (see App.tsx), so
// nothing that read this value can be left holding the old answer.

import { DEFAULT_LOCALE, type Locale } from "./locales";

let active: Locale = DEFAULT_LOCALE;

export function getActiveLocale(): Locale {
  return active;
}

export function setActiveLocale(locale: Locale): void {
  active = locale;
}
