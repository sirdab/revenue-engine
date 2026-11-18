import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate, translate, translatePlural } from "./translate";

const en = {
  "greet": "Hello {name}",
  "plain": "Plain",
  "apples#one": "{count} apple",
  "apples#other": "{count} apples",
};
const ar = {
  "plain": "عادي",
  "apples#zero": "لا تفاح",
  "apples#one": "تفاحة واحدة",
  "apples#two": "تفاحتان",
  "apples#few": "{count} تفاحات",
  "apples#many": "{count} تفاحة",
  "apples#other": "{count} تفاح",
};

test("interpolate fills placeholders", () => {
  assert.equal(interpolate("Hello {name}", { name: "Sam" }), "Hello Sam");
  assert.equal(interpolate("{a} and {b}", { a: 1, b: 2 }), "1 and 2");
});

test("an unsupplied placeholder stays visible rather than rendering empty", () => {
  // A sentence that reads fine and is wrong is the bug nobody reports.
  assert.equal(interpolate("Assign to {who}", {}), "Assign to {who}");
});

test("a message missing from the locale falls back to English", () => {
  assert.equal(translate(ar, en, "greet", { name: "Sara" }), "Hello Sara");
});

test("a message present in the locale is not taken from English", () => {
  assert.equal(translate(ar, en, "plain"), "عادي");
});

test("a key missing everywhere renders as the key, not as empty space", () => {
  assert.equal(translate(ar, en, "nope"), "nope");
});

test("English selects one/other", () => {
  assert.equal(translatePlural(en, en, "en", "en", "apples", 1), "1 apple");
  assert.equal(translatePlural(en, en, "en", "en", "apples", 3), "3 apples");
});

test("Arabic selects all six categories, which a count===1 ternary cannot", () => {
  const t = (n: number) => translatePlural(ar, en, "ar", "ar-SA", "apples", n);
  assert.equal(t(0), "لا تفاح");
  assert.equal(t(1), "تفاحة واحدة");
  assert.equal(t(2), "تفاحتان");
  assert.equal(t(5), "5 تفاحات");
  assert.equal(t(15), "15 تفاحة");
  assert.equal(t(100), "100 تفاح");
});

test("count is injected without the call site passing it twice", () => {
  assert.equal(translatePlural(en, en, "en", "en", "apples", 7), "7 apples");
});

test("a locale missing a category it can select falls back to other", () => {
  // Defense-in-depth for a case locale-parity.test.ts already forbids.
  const partial = { "apples#other": "{count} تفاح" };
  assert.equal(translatePlural(partial, en, "ar", "ar-SA", "apples", 2), "2 تفاح");
});
