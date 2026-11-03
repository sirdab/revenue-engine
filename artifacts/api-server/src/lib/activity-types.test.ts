import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The activity-type vocabulary is duplicated by hand across the server and the
// frontend: the pg enum is the source of truth, but Insights' filter option
// list, the Insights compiler's allowlist, the activities page's filter chips
// and the automation wizard's type dropdown are all plain arrays with no type
// link back to it. TypeScript cannot catch a miss there — a type added to the
// enum but not to one of these lists is simply unreachable in that surface,
// silently. These tests are the link.

process.env.DATABASE_URL ??=
  "postgres://test:test@localhost:5432/activity_types_test";

const { activityTypeEnum } = await import("@workspace/db/schema");
const { ACTIVITY_TYPE_OPTIONS } = await import("./insights/fields.ts");

const ENUM_VALUES = [...activityTypeEnum.enumValues].sort();
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

/** The string literals inside a named `const NAME = [...]` array in a source file. */
function literalsInArray(relPath: string, name: string): string[] {
  const src = readFileSync(path.join(repoRoot, relPath), "utf8");
  const start = src.indexOf(name);
  assert.notEqual(start, -1, `${name} not found in ${relPath}`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("]", open);
  assert.ok(open !== -1 && close > open, `could not read ${name} in ${relPath}`);
  return [...src.slice(open, close).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

test("the Insights filter option list covers every activity type", () => {
  assert.deepEqual(
    ACTIVITY_TYPE_OPTIONS.map((o) => o.value).sort(),
    ENUM_VALUES,
  );
});

test("the Insights compiler allowlist covers every activity type", () => {
  assert.deepEqual(
    literalsInArray(
      "artifacts/api-server/src/lib/insights/compile-activities.ts",
      "const ACTIVITY_TYPES = new Set(",
    ).sort(),
    ENUM_VALUES,
  );
});

test("the activities page filter chips cover every activity type", () => {
  assert.deepEqual(
    literalsInArray("artifacts/login/src/pages/activities.tsx", "const TYPE_OPTIONS =").sort(),
    ENUM_VALUES,
  );
});

test("the automation wizard offers every activity type", () => {
  assert.deepEqual(
    literalsInArray(
      "artifacts/login/src/components/settings/automation-wizard.tsx",
      "const ACTIVITY_TYPES = [",
    )
      .filter((v) => v !== "value" && v !== "label")
      .sort(),
    ENUM_VALUES,
  );
});
