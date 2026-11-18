import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// THE MIGRATION JOURNAL MUST BE ORDERED BY `when`, NOT JUST BY FILENAME.
//
// Drizzle decides what to run from the journal's `when` timestamp, never from
// the number in the filename. It reads the newest `created_at` already in
// drizzle.__drizzle_migrations ONCE, before the loop, then runs a migration
// only when that watermark is strictly below the migration's `when`:
//
//   const lastDbMigration = dbMigrations[0];
//   ...
//   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
//
// (drizzle-orm/pg-core/dialect.js). Anything at or below the watermark is
// skipped, in silence, and `drizzle-kit migrate` still exits 0.
//
// So renumbering one migration around another makes filename order and
// authoring order disagree, and the file that ends up numbered later but was
// written earlier is never applied to any database that already existed.
// Production shipped exactly that: 0064 and 0065 were written before 0063 and
// renumbered above it, the deploy carrying 0063 moved the watermark past both,
// and two schema objects silently never got created.
//
// WHY THIS TEST AND NOT A REAL MIGRATION RUN: `!lastDbMigration ||` short
// circuits when the database has no migrations at all, so EVERY migration
// applies to an empty database regardless of its timestamp. Migrating from
// empty, which is what CI does and what we proved the last renumber with,
// cannot detect this and never could. It is a check that can only pass.
//
// `drizzle-kit check` does not catch it either. It reports "Everything's fine"
// on the exact tree that took production down.
//
// This test lives in api-server rather than lib/db because this is where CI
// actually runs tests. A guard that does not run is the failure it is meant to
// prevent.

const JOURNAL = fileURLToPath(
  new URL("../../../../lib/db/drizzle/meta/_journal.json", import.meta.url),
);

interface Entry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Migrations already merged whose `when` sits below an earlier entry's.
 *
 * Any listed here are HISTORY and cannot be repaired by editing them: every environment
 * that migrated from an empty database did apply them, so changing their
 * timestamps now would make them run a second time and fail. They stay listed
 * here so the rule below can be strict about everything new.
 *
 * None yet.
 */
const KNOWN_OUT_OF_ORDER = new Set<string>([]);

function entries(): Entry[] {
  return JSON.parse(readFileSync(JOURNAL, "utf8")).entries as Entry[];
}

test("every new migration is authored after every migration before it", () => {
  // The running maximum, not the previous entry, because that is what drizzle
  // compares against: one watermark read before the loop, never the neighbour.
  let watermark = -1;
  const offenders: string[] = [];
  for (const e of entries()) {
    if (e.when <= watermark && !KNOWN_OUT_OF_ORDER.has(e.tag)) {
      offenders.push(`${e.tag} (when=${e.when}, watermark=${watermark})`);
    }
    watermark = Math.max(watermark, e.when);
  }
  assert.deepEqual(
    offenders,
    [],
    `These migrations would be SKIPPED SILENTLY on any database that already exists, ` +
      `because their timestamp is below one that came before them:\n  ${offenders.join("\n  ")}\n\n` +
      `This usually means a migration was renumbered around another one. Renumbering the ` +
      `FILE does not reorder the RUN. Fix it by regenerating the migration so it gets a ` +
      `current timestamp, or add a forward repair migration; do not edit the timestamp of ` +
      `anything already merged, because environments that migrated from empty have applied it.`,
  );
});

test("the allow list only names migrations that are really out of order", () => {
  // Stops the list becoming a dumping ground. If a repair or a rebase puts one
  // of these back in order, it has to leave, so the list keeps meaning what it
  // says.
  let watermark = -1;
  const genuinelyOut = new Set<string>();
  for (const e of entries()) {
    if (e.when <= watermark) genuinelyOut.add(e.tag);
    watermark = Math.max(watermark, e.when);
  }
  const stale = [...KNOWN_OUT_OF_ORDER].filter((t) => !genuinelyOut.has(t));
  assert.deepEqual(stale, [], `No longer out of order, remove from the allow list: ${stale}`);
});

test("every journal entry has a migration file, and every file is in the journal", () => {
  // The direction people check is journal to file. The other direction is what
  // catches an entry dropped by a bad merge of _journal.json, which is a real
  // thing that has happened twice: git auto merging that file has produced both
  // a duplicated index and a lost entry, and both read fine in a diff.
  const dir = fileURLToPath(new URL("../../../../lib/db/drizzle/", import.meta.url));
  const tags = new Set(entries().map((e) => e.tag));
  const files = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -4)),
  );
  assert.deepEqual([...tags].filter((t) => !files.has(t)), [], "in journal but no .sql file");
  assert.deepEqual([...files].filter((f) => !tags.has(f)), [], ".sql file missing from journal");
});

test("indexes are unique and ascending", () => {
  // A git merge of _journal.json once produced two entries both at idx 64. It
  // was valid JSON and looked entirely plausible in the diff.
  const idx = entries().map((e) => e.idx);
  assert.equal(new Set(idx).size, idx.length, "duplicate idx in the journal");
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), "journal indexes are not ascending");
});
