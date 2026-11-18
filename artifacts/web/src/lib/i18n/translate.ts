// The message lookup itself: pure, React-free, and unit-tested. Everything
// stateful (which locale is active, writing it to the document) lives in
// i18n.tsx; everything here is a function of its arguments.
//
// Dictionaries are FLAT, dotted-key JSON objects ({"deals.title": "..."})
// rather than nested trees. Three reasons, all of which bit somebody else
// first: a flat file diffs one line per changed message, the key-parity check
// in locale-parity.test.ts is a set comparison instead of a tree walk, and
// `keyof typeof en` types the whole key space for free without a recursive
// conditional type that tsc has to re-expand on every build.

import type { Locale } from "./locales";

export type Dictionary = Record<string, string>;

/** `{name}` — deliberately not `{{name}}`; there is no escaping to get wrong
 *  because these strings are rendered as React children, never as HTML. */
const PLACEHOLDER = /\{(\w+)\}/g;

export type InterpolationValues = Record<string, string | number>;

export function interpolate(
  template: string,
  values: InterpolationValues | undefined,
): string {
  if (!values) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];
    // An unsupplied placeholder stays visible as `{name}`. Rendering it as
    // an empty string would turn a missing argument into a sentence that
    // reads fine and is wrong ("Assign to ?" -> "Assign to"), which is
    // exactly the class of bug nobody reports.
    return value === undefined ? match : String(value);
  });
}

/**
 * Looks one message up, falling back to English and then to the key itself.
 *
 * The fallback chain is defense-in-depth, not the plan: locale-parity.test.ts
 * fails the build when the two dictionaries disagree about which keys exist.
 * It matters anyway at runtime, because showing an Arabic reader the English
 * sentence is a far better failure than showing them `deals.title`.
 */
export function lookup(
  dict: Dictionary,
  fallbackDict: Dictionary,
  key: string,
): string | undefined {
  return dict[key] ?? fallbackDict[key];
}

export function translate(
  dict: Dictionary,
  fallbackDict: Dictionary,
  key: string,
  values?: InterpolationValues,
): string {
  const template = lookup(dict, fallbackDict, key);
  if (template === undefined) {
    onMissingKey(key);
    return key;
  }
  return interpolate(template, values);
}

/**
 * Plural form of `key`, chosen by `Intl.PluralRules` for `locale`.
 *
 * The dictionary holds one entry per category as `key#one`, `key#other`, ...
 * English needs two; Arabic has six (zero/one/two/few/many/other) and gets
 * them wrong in a way English speakers cannot eyeball, which is the whole
 * reason this goes through Intl rather than a `count === 1` ternary.
 *
 * `count` is injected as `{count}` automatically so no call site has to
 * remember to pass it twice.
 */
export function translatePlural(
  dict: Dictionary,
  fallbackDict: Dictionary,
  locale: Locale,
  tag: string,
  key: string,
  count: number,
  values?: InterpolationValues,
): string {
  const category = pluralRules(tag).select(count);
  const template =
    lookup(dict, fallbackDict, `${key}#${category}`) ??
    // Every plural key is required to define `other`, so this is the one
    // fallback that is always available when a locale legitimately omits a
    // category it never selects.
    lookup(dict, fallbackDict, `${key}#other`);
  if (template === undefined) {
    onMissingKey(`${key}#${category}`);
    return key;
  }
  return interpolate(template, { count, ...values });
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralRules(tag: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRulesCache.set(tag, rules);
  }
  return rules;
}

/**
 * Splits a message into its literal text and its placeholders, so a caller
 * can substitute something that is not a string.
 *
 * Needed because some values are elements rather than text -- `<Money>`
 * renders the riyal as an inline SVG, since font coverage for U+20C0 is still
 * patchy -- and a sentence containing one cannot be produced by string
 * interpolation. The alternative, cutting the sentence into "{amount}" and
 * " owed" and concatenating them in JSX, hard-codes English word order and is
 * exactly what breaks first in a language that puts them the other way round.
 *
 * Returns the message as an alternating sequence: literal text, placeholder
 * name, literal text, ... An unknown placeholder comes back as literal text
 * (`{name}`), matching `interpolate`.
 */
export function splitTemplate(
  template: string,
): ({ text: string } | { placeholder: string })[] {
  const parts: ({ text: string } | { placeholder: string })[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const at = match.index;
    if (at > last) parts.push({ text: template.slice(last, at) });
    parts.push({ placeholder: match[1] });
    last = at + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

const warnedKeys = new Set<string>();

/** Loud in dev, silent in production — a missing key is a build-time bug
 *  (see locale-parity.test.ts) and shouldn't spam a user's console. */
function onMissingKey(key: string): void {
  if (!import.meta.env?.DEV) return;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(`[i18n] missing message key: ${key}`);
}
