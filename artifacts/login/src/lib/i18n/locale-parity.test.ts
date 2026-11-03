import { test } from "node:test";
import assert from "node:assert/strict";
import en from "./en.json" with { type: "json" };
import ar from "./ar.json" with { type: "json" };
import { LOCALES, LOCALE_INFO, type Locale } from "./locales";

// The check that keeps the two dictionaries in step: a key added to one
// dictionary and forgotten in the other fails the build instead of silently
// showing an Arabic user an English sentence forever.
//
// It cannot be a plain set comparison, because the two languages do not need
// the same number of plural forms. English selects two categories (one,
// other); Arabic selects six (zero, one, two, few, many, other). Requiring
// identical key sets would either force five dead English entries per plural
// or forbid Arabic from having the forms its grammar requires. So plural keys
// are compared by their BASE, and each locale is separately required to carry
// exactly the categories Intl says it can select.

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, ar };

const PLURAL_SEPARATOR = "#";

function splitKey(key: string): { base: string; category: string | null } {
  const at = key.indexOf(PLURAL_SEPARATOR);
  return at === -1
    ? { base: key, category: null }
    : { base: key.slice(0, at), category: key.slice(at + 1) };
}

function baseKeys(dict: Record<string, string>): Set<string> {
  return new Set(Object.keys(dict).map((key) => splitKey(key).base));
}

function pluralBases(dict: Record<string, string>): Set<string> {
  const bases = new Set<string>();
  for (const key of Object.keys(dict)) {
    const { base, category } = splitKey(key);
    if (category !== null) bases.add(base);
  }
  return bases;
}

test("every locale defines the same set of message keys", () => {
  const reference = baseKeys(en);
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const theirs = baseKeys(DICTIONARIES[locale]);
    const missing = [...reference].filter((key) => !theirs.has(key)).sort();
    const extra = [...theirs].filter((key) => !reference.has(key)).sort();
    assert.deepEqual(
      missing,
      [],
      `${locale}.json is missing keys that en.json defines: ${missing.join(", ")}`,
    );
    assert.deepEqual(
      extra,
      [],
      `${locale}.json defines keys en.json does not: ${extra.join(", ")}`,
    );
  }
});

test("a key is plural in every locale or in none", () => {
  const reference = pluralBases(en);
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const theirs = pluralBases(DICTIONARIES[locale]);
    assert.deepEqual(
      [...theirs].sort(),
      [...reference].sort(),
      `${locale}.json disagrees with en.json about which keys are plural — a base that takes a count in one language takes one in all of them`,
    );
  }
});

test("each locale carries exactly the plural categories Intl can select", () => {
  for (const locale of LOCALES) {
    const dict = DICTIONARIES[locale];
    const required = new Set(
      new Intl.PluralRules(
        LOCALE_INFO[locale].tag,
      ).resolvedOptions().pluralCategories,
    );
    const byBase = new Map<string, Set<string>>();
    for (const key of Object.keys(dict)) {
      const { base, category } = splitKey(key);
      if (category === null) continue;
      const set = byBase.get(base) ?? new Set<string>();
      set.add(category);
      byBase.set(base, set);
    }
    for (const [base, categories] of byBase) {
      assert.deepEqual(
        [...categories].sort(),
        [...required].sort(),
        `${locale}.json "${base}" must define exactly the categories ${locale} selects (${[...required].sort().join(", ")})`,
      );
    }
  }
});

test("a placeholder used in English is available in every translation", () => {
  const placeholders = (s: string) =>
    new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

  for (const locale of LOCALES) {
    if (locale === "en") continue;
    for (const [key, translated] of Object.entries(DICTIONARIES[locale])) {
      // A plural variant's English source may be a different category.
      const { base, category } = splitKey(key);
      const source =
        en[key as keyof typeof en] ??
        en[`${base}#other` as keyof typeof en] ??
        en[base as keyof typeof en];
      if (source === undefined) continue;
      const allowed = placeholders(source);
      // `count` is injected by translatePlural for every plural key, so a
      // translation may use it even when the English form happens not to.
      if (category !== null) allowed.add("count");
      const unknown = [...placeholders(translated)].filter(
        (name) => !allowed.has(name),
      );
      assert.deepEqual(
        unknown,
        [],
        `${locale}.json "${key}" uses {${unknown.join("}, {")}}, which the English message does not supply — it would render literally`,
      );
    }
  }
});
