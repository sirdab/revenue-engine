---
name: find-dead-code
description: Find dead code (unused exports, unreferenced files, unused dependencies), delete what is provably unreferenced, and report what needs human judgment. Use for dead-code audits, "what can we delete", or a scheduled cleanup routine. Applies the mechanically safe deletions and reports the rest.
---

# Find dead code

The other half of "too much code": exports nobody imports, files nobody
references, deps nobody uses. LLM-assisted work leaves these everywhere — a
helper gets inlined, its export stays; a component gets replaced, the old file
lingers. Same hybrid shape as `find-duplicate-components`: a mechanical tool
proposes, Claude's judgment disposes.

## Scope

Default: the whole workspace, not just `artifacts/web`. Dead code in
`artifacts/api-server` counts too. For a routine, scope to **what changed in the
last 24h**, see "Incremental mode" below.

This skill splits every finding into two buckets: **APPLY**, which it deletes
itself and verifies, and **REPORT**, which it leaves alone and writes up. Be
strict about the boundary. When in doubt it goes to REPORT.

## The false-positive problem (why the judgment layer earns its weight)

Mechanical tools flag things that are *intentionally* exported-but-unused-here.
**Never recommend deleting** these — they're the guardrail:

- **Generated code** — anything under a `generated/` dir (`@workspace/api-zod`,
  `@workspace/api-client-react`). Codegen emits the full surface; "unused" is
  expected. Exclude entirely.
- **Public API surface** — `@workspace/*` libs (`deals-filter`, `db`, `api-*`)
  export for *other packages*; a symbol unused inside its own package may be a
  consumer's entry point. Check cross-package usage before flagging.
- **Framework entry points** — route components, `main.tsx`, Vite/config files,
  `seed`/`bootstrap` scripts, test setup.
- **Dynamic references** — string-keyed lookups, `import()`, registry maps.
- **ts-prune quirk** — it mis-reports `satisfies` / type args (e.g. it flagged
  `route-preload.ts:20 - satisfies` and `- Record`). Ignore non-symbol "exports".

## Workflow

### 1. Mechanical pass — knip (primary), ts-prune (fallback)

```bash
# knip — unused files + exports + deps, monorepo-aware, more accurate
npx --yes knip --workspace artifacts/web --no-progress \
  --include files,exports,dependencies 2>/dev/null

# fallback / quick cross-check — unused exports only (needs a tsconfig)
npx --yes ts-prune -p artifacts/web/tsconfig.json \
  | grep -v "(used in module)"
```

knip may report false positives without entry-point config; that's fine — the
filtering above is Claude's job, not knip's. Keep raw output as the debug trail.

### 2. Judgment

For each candidate, classify: `remove` (dead, safe) · `keep-public` (API surface /
entry point) · `keep-dynamic` (referenced indirectly) · `generated` (ignore). For
each `remove`, give file:line, the symbol/file, and one line on *how you confirmed
nothing references it* (grep for the name across the repo, including string usages).
If a grep finds any reference you can't rule out → downgrade to `keep-*` with a note.

### 3. Sort into APPLY and REPORT

**APPLY**, delete it yourself:

- An export, symbol or file your confirmation step proves unreferenced.
- A redundant `export` keyword on a constant only read inside its own module. Keep
  the constant, remove only the `export`.

**REPORT**, leave the code alone:

- Removing a dependency from any `package.json`. Dynamic requires and postinstall
  hooks make that unsafe, so unused deps are always REPORT.
- Anything on the never-flag list above.
- A judgment call even though the symbol is unreferenced. `DIRECTION_INBOUND` and
  `SOURCE_TYPE_WHATSAPP` in `artifacts/web/src/lib/hatif-api.ts` are the exemplar:
  unreferenced, but they round out a documented enum whose sibling helpers navigate
  by elimination. A human picks.
- **Read the doc comment first.** Two comment patterns turn an unreferenced symbol
  into a REPORT case, and both look mechanically safe to a tool:
  - **A declared test hook or seam.** `resetServiceCategoryCache` in
    `artifacts/api-server/src/lib/service-categories.ts` is unreferenced and its
    comment says it is a test hook. A missing test is not a reason to delete the seam.
  - **A claimed consumer you cannot find.** `SEEDED_DATA_FIELD_DEFS` in
    `artifacts/api-server/src/lib/deal-fields.ts` says it is exported so the webhook
    can resolve incoming fields, and no webhook references it. Either the comment is
    stale or that caller regressed. Those are opposite fixes, so a human decides.

### 4. Verify, then report

Verify every applied deletion with the repo's real CI sequence before keeping it:

```bash
pnpm install --frozen-lockfile
BASE_PATH=/ PORT=8080 pnpm run build
pnpm --filter @workspace/api-server run typecheck:test
pnpm --filter @workspace/api-server run test
```

`typecheck:test` is not optional: the main typecheck excludes `*.test.ts`, so a plain
typecheck won't tell you whether a deletion broke a test file. If a deletion fails
verification, revert that one and move it to REPORT with the exact error.

Write `docs/maintenance/dead-code-<YYYY-MM-DD>.md`: summary counts, what was applied
(symbol/file · how confirmed · commit), what was left for a human and why, `keep-*`
dismissals so the next run doesn't re-flag them, and anything reverted.

## Incremental mode (for the nightly routine)

Goal: surface just what *yesterday's changes* orphaned, not the whole backlog.

1. Find commits in the window: `git log --since="24 hours ago" --name-only`.
2. Run knip on `HEAD`, and again on the pre-window state
   (`git stash` is not needed — use a scratch worktree or `git show`/checkout of
   `HEAD@{24.hours.ago}` in a temp checkout), then **diff the two unused-lists** →
   items that became unused *because of* the window's changes.
3. If the diff is empty, report "no new dead code" and stop. Only newly-orphaned
   symbols are worth a nightly ping.
