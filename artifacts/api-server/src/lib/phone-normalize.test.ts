import { test } from "node:test";
import assert from "node:assert/strict";

// queries.ts pulls in @workspace/db, whose pool throws at import without a
// DATABASE_URL. Nothing here touches the database.
process.env.DATABASE_URL ??= "postgres://phone-normalize-test/unused";

// PHONE_COUNTRY_CODE is read once at module load, so each setting needs a
// fresh module instance: set the env var, then import under a cache-busting
// query.
async function loadQueriesWith(
  countryCode: string | undefined,
): Promise<typeof import("./queries.ts")> {
  const previous = process.env.PHONE_COUNTRY_CODE;
  if (countryCode === undefined) delete process.env.PHONE_COUNTRY_CODE;
  else process.env.PHONE_COUNTRY_CODE = countryCode;
  try {
    return await import(`./queries.ts?cc=${countryCode ?? "none"}`);
  } finally {
    if (previous === undefined) delete process.env.PHONE_COUNTRY_CODE;
    else process.env.PHONE_COUNTRY_CODE = previous;
  }
}

test("phoneDigits drops formatting, an international 00 and a trunk 0", async () => {
  const { phoneDigits } = await loadQueriesWith(undefined);
  assert.equal(phoneDigits("+44 7700 900123"), "447700900123");
  assert.equal(phoneDigits("0044 7700-900123"), "447700900123");
  assert.equal(phoneDigits("07700 900123"), "7700900123");
  assert.equal(phoneDigits("(555) 010-0199"), "5550100199");
  assert.equal(phoneDigits(null), "");
});

test("without PHONE_COUNTRY_CODE no country code is assumed", async () => {
  const { phoneNsn, phoneDigitsVariants } = await loadQueriesWith(undefined);
  assert.equal(phoneNsn("+44 7700 900123"), "447700900123");
  assert.equal(phoneNsn("+966 54 084 3494"), "966540843494");
  assert.deepEqual(phoneDigitsVariants("7700900123"), ["7700900123"]);
});

test("PHONE_COUNTRY_CODE makes national and international forms meet", async () => {
  const { phoneNsn, phoneDigits, phoneDigitsVariants } = await loadQueriesWith("44");
  const national = phoneNsn("07700 900123");
  assert.equal(national, "7700900123");
  assert.equal(phoneNsn("+44 7700 900123"), national);
  assert.equal(phoneNsn("0044 7700 900123"), national);
  // A search term in either form is a substring of either stored form.
  for (const stored of ["+44 7700 900123", "07700 900123"]) {
    assert.ok(phoneDigits(stored).includes(phoneNsn("+447700900123")));
    assert.ok(phoneDigits(stored).includes(phoneNsn("07700900123")));
  }
  // Another country's number keeps its code.
  assert.equal(phoneNsn("+1 555 010 0199"), "15550100199");
  assert.deepEqual(phoneDigitsVariants(national), [national, "447700900123"]);
});

test("phoneDigitsSql mirrors the migration 0002 index expression", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(
    new URL("../../../../lib/db/drizzle/0002_phone_search_generic.sql", import.meta.url),
    "utf8",
  );
  const source = readFileSync(new URL("./queries.ts", import.meta.url), "utf8");
  const sqlExpr = /sql<string>`(ltrim\(regexp_replace\(coalesce\(\$\{col\}[^`]*)`/.exec(source)?.[1];
  assert.ok(sqlExpr, "phoneDigitsSql expression not found");
  assert.ok(
    migration.includes(sqlExpr.replace("${col}", '"phone"')),
    "phoneDigitsSql and the persons_phone_digits_trgm index have drifted apart",
  );
});
