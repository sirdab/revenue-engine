import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsUtc, hostedTrialMonths, workspaceTrial } from "./trial.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("calendar months, clamped to the end of a shorter month", () => {
  const iso = (s: string, n: number) => addMonthsUtc(new Date(s), n).toISOString();
  assert.equal(iso("2026-01-15T10:00:00.000Z", 3), "2026-04-15T10:00:00.000Z");
  assert.equal(iso("2026-11-30T08:30:00.000Z", 3), "2027-02-28T08:30:00.000Z");
  assert.equal(iso("2027-11-30T08:30:00.000Z", 3), "2028-02-29T08:30:00.000Z");
  assert.equal(iso("2026-10-31T00:00:00.000Z", 1), "2026-11-30T00:00:00.000Z");
});

test("no trial unless HOSTED_TRIAL_MONTHS is a sensible whole number", () => {
  const created = new Date("2026-11-01T00:00:00.000Z");
  withEnv({ HOSTED_TRIAL_MONTHS: undefined }, () => assert.equal(workspaceTrial(created), null));
  for (const bad of ["", "0", "-3", "2.5", "abc", "100"]) {
    withEnv({ HOSTED_TRIAL_MONTHS: bad }, () => assert.equal(hostedTrialMonths(), null, bad));
  }
  withEnv({ HOSTED_TRIAL_MONTHS: "3", BILLING_CONTACT_EMAIL: "sales@example.com" }, () =>
    assert.deepEqual(workspaceTrial(created), {
      endsAt: "2027-02-01T00:00:00.000Z",
      contactEmail: "sales@example.com",
    }),
  );
  withEnv({ HOSTED_TRIAL_MONTHS: "3", BILLING_CONTACT_EMAIL: "not an email" }, () =>
    assert.equal(workspaceTrial(created)?.contactEmail, null),
  );
});
