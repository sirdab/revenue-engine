import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currencyForNewAmount,
  currentRegionalSettings,
  isValidCurrency,
  isValidPhoneCountryCode,
  isValidTimeZone,
  resolveEffective,
  runWithRegionalSettings,
  serverDefaults,
  storedFromTenant,
  timeZoneSql,
} from "./regional-context.ts";

const UNSET = { timezone: null, weekStart: null, defaultCurrency: null, phoneCountryCode: null, defaultLocale: null };

test("validators accept real values and refuse everything else", () => {
  assert.ok(isValidTimeZone("Asia/Riyadh"));
  assert.ok(isValidTimeZone("UTC"));
  assert.ok(!isValidTimeZone("Mars/Olympus"));
  assert.ok(!isValidTimeZone("Asia/Riyadh'; drop table deals; --"));
  assert.ok(isValidCurrency("SAR") && isValidCurrency("USD"));
  assert.ok(!isValidCurrency("sar") && !isValidCurrency("XYZ1") && !isValidCurrency("ABC"));
  assert.ok(isValidPhoneCountryCode("966") && isValidPhoneCountryCode("1"));
  assert.ok(!isValidPhoneCountryCode("0966") && !isValidPhoneCountryCode("12345") && !isValidPhoneCountryCode("+966"));
});

test("an unset workspace behaves exactly like the server defaults", () => {
  const prev = process.env.APP_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  try {
    const eff = resolveEffective(storedFromTenant(UNSET));
    assert.deepEqual(eff, serverDefaults());
    assert.equal(eff.timezone, "UTC");
    assert.equal(eff.weekStart, 1);
    assert.equal(eff.defaultCurrency, "USD");
  } finally {
    if (prev !== undefined) process.env.APP_TIMEZONE = prev;
  }
});

test("APP_TIMEZONE is the server default, and a bad one falls back to UTC", () => {
  const prev = process.env.APP_TIMEZONE;
  try {
    process.env.APP_TIMEZONE = "Europe/London";
    assert.equal(serverDefaults().timezone, "Europe/London");
    process.env.APP_TIMEZONE = "Not/AZone";
    assert.equal(serverDefaults().timezone, "UTC");
  } finally {
    if (prev === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = prev;
  }
});

test("stored values win, and a hand-edited bad value reads as unset", () => {
  const eff = resolveEffective(
    storedFromTenant({ timezone: "Asia/Riyadh", weekStart: 0, defaultCurrency: "SAR", phoneCountryCode: "966", defaultLocale: "ar" }),
  );
  assert.equal(eff.timezone, "Asia/Riyadh");
  assert.equal(eff.weekStart, 0);
  assert.equal(eff.defaultCurrency, "SAR");
  assert.equal(eff.phoneCountryCode, "966");
  assert.equal(eff.defaultLocale, "ar");

  const bad = storedFromTenant({ timezone: "x'y", weekStart: 3, defaultCurrency: "zz", phoneCountryCode: "0", defaultLocale: "fr" });
  assert.deepEqual(bad, UNSET);
});

test("outside a workspace the server defaults apply; inside, the workspace's", () => {
  assert.deepEqual(currentRegionalSettings(), serverDefaults());
  const riyadh = resolveEffective({ ...UNSET, timezone: "Asia/Riyadh", defaultCurrency: "SAR" });
  runWithRegionalSettings(riyadh, () => {
    assert.equal(currentRegionalSettings().timezone, "Asia/Riyadh");
  });
});

test("timeZoneSql is a quoted literal of the workspace zone", () => {
  const riyadh = resolveEffective({ ...UNSET, timezone: "Asia/Riyadh" });
  runWithRegionalSettings(riyadh, () => {
    const chunk = timeZoneSql() as unknown as { queryChunks: { value: string[] }[] };
    assert.deepEqual(chunk.queryChunks[0].value, ["'Asia/Riyadh'"]);
  });
});

test("currency for a new amount: workspace choice, else the user's legacy default, else USD", () => {
  // No workspace choice: unchanged from before workspace settings existed.
  assert.equal(currencyForNewAmount("EUR"), "EUR");
  assert.equal(currencyForNewAmount(undefined), "USD");
  runWithRegionalSettings(resolveEffective({ ...UNSET, defaultCurrency: "SAR" }), () => {
    assert.equal(currencyForNewAmount("USD"), "SAR");
    assert.equal(currencyForNewAmount(null), "SAR");
  });
});
