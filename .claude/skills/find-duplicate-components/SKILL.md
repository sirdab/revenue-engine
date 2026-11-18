---
name: find-duplicate-components
description: Audit the frontend for duplicate, near-duplicate and re-implemented React components, replace hand-rolled copies of existing ui/ primitives, and report the rest as a ranked consolidation plan. Use for dedup audits, "is someone rebuilding what we already have", design-system-drift checks, or a scheduled duplication routine. Applies only exact-parity adopt-primitive swaps; merges and extract-to-shared are always report-only.
---

# Find duplicate components

Many builders → the same widget gets rebuilt under a new name. Three flavors, and
no single tool catches all three — so this skill is a **hybrid**:

| Flavor | Example here | Caught by |
|---|---|---|
| **Copy-paste / near-clone** (Type 1-2) | `bidding-deals-list-view` ⟷ `quotes-list-view` share 482 lines | jscpd (mechanical) |
| **Functional re-implementation** (Type 4) | a new confirm dialog when `shared/archive-confirm-dialog` + `ui/alert-dialog` exist | Claude (semantic) |
| **Design-system drift** | a hand-rolled `<button className>` / custom modal instead of `ui/button` / `ui/dialog` | Claude (grep + semantic) |

jscpd narrows 170+ files to ~15-25 candidate pairs cheaply and deterministically;
Claude does the judgment jscpd structurally cannot. **Default to under-flagging** —
a false "these are duplicates" wastes a builder's afternoon; a missed one costs
what we already have. When business logic genuinely differs, say `keep`.

## Scope

Default target: `artifacts/web/src/components` (the product frontend, `~/components/ui`
= shadcn primitives, `~/components/shared` = the intended reuse home). Override the
first arg to point at another app's component root.

Findings split into two buckets: **APPLY**, one narrow swap the skill performs and
verifies itself, and **REPORT**, everything else. See step 4.

## Conventions this repo already has (know these before flagging)

- **`components/ui/*`** — shadcn/Radix primitives (`button`, `dialog`, `select`,
  `alert-dialog`, `table`, `data-table` lives in `shared`, …). Re-implementing one
  of these by hand is drift → verdict `adopt-primitive`.
- **`components/shared/*`** — where cross-feature components belong (`data-table`,
  `entity-timeline`, `entity-history-dialog`, `money`, `multi-select-filter`,
  `column-picker`, …). If two feature folders duplicate something that fits here,
  verdict `extract-to-shared`.
- **`@workspace/deals-filter`** — the shared filter DSL (server + client). Filter
  *builders* in feature folders should render this, not re-derive condition logic.
- Feature folders (`deals`, `quotes`, `bidding-deals`, `warehouses`, `accounts`,
  `organizations`, `persons`, `contacts`, `insights`, `settings`) — a clone that
  spans **two** of these is the strongest "rebuilt elsewhere" signal.

## Workflow

### 1. Mechanical pass — jscpd (zero-install via npx)

```bash
TARGET="${1:-artifacts/web/src/components}"
OUT="$(mktemp -d)/jscpd"          # or a scratchpad dir; do NOT write into the repo
npx --yes jscpd "$TARGET" \
  --min-tokens 40 \
  --formats-exts "typescript:ts,tsx" \
  --reporters json --output "$OUT" --silent

node .claude/skills/find-duplicate-components/scripts/rank-clones.mjs "$OUT/jscpd-report.json"
# add --json for a compact machine list (top ranges per pair) to drive step 3
```

`rank-clones.mjs` aggregates all clones between each file-pair, ranks by shared
lines, and flags (▲) pairs that span two feature folders. Keep `$OUT/jscpd-report.json`
around — it's the debug entry point (exact line ranges) if a verdict looks wrong.
(Optional: if `cargo` is present, `similarity-ts <target> --threshold 0.82 --cross-file`
adds an AST/structural signal jscpd misses. Skip if not installed — don't `cargo install`.)

### 2. Design-system-drift pass — what jscpd can't see

A hand-rolled dropdown is **not** a token-clone of Radix `select.tsx`, so jscpd
misses it. Grep feature folders (exclude `ui/`) for primitives built from scratch:

```bash
# interactive widgets NOT importing from the ui/ layer are drift suspects
grep -rlED 'role="dialog"|position: *fixed|<table|onKeyDown.*Escape' \
  "$TARGET" --include=*.tsx | grep -v '/ui/'
```

For each suspect, check whether it imports the matching `@/components/ui/*`
primitive. If it reinvents one → candidate, verdict `adopt-primitive`.

### 3. Semantic judgment — the value Claude adds

For each candidate pair/cluster from steps 1-2, open the **specific line ranges**
(rank-clones gives them — don't re-read whole files) and decide. To keep a routine
cheap, judge independent clusters in parallel via the Agent tool (one cluster each),
each returning a structured verdict.

For every candidate record:
- **files + exported component names + one-line purpose** of each.
- **verdict**, one of:
  - `merge` — same component under two names; keep one, delete the other.
  - `extract-to-shared` — genuinely shared behavior living in ≥2 feature folders → lift into `components/shared`.
  - `adopt-primitive` — hand-rolled; replace with an existing `ui/` (or `shared/`) primitive.
  - `keep` — structurally similar but the business logic/props/purpose differ. **Say why**, so the next run doesn't re-flag it.
- **confidence** (high/med/low) and **effort** (S/M/L).
- **recommendation** — one concrete sentence naming the target home
  (e.g. "consolidate the 4 list-views onto `shared/data-table.tsx`; each keeps only its column defs").
- **rationale** — the *why*, in one line. This is the learning we're preserving.

Guardrails (from the research — LLMs over-flag look-alikes):
- Similar JSX shape ≠ duplicate. Compare **props + purpose + data source**, not markup.
- Boilerplate that every component shares (imports, a `<Card>` wrapper) is not a clone.
- If unsure → `keep` with a note, not `merge`.

### 4. Sort into APPLY and REPORT

**APPLY**, do the swap yourself. Exactly one case, and all of it must hold:

- an `adopt-primitive` candidate: a hand-rolled copy of an existing `components/ui/*`
  primitive, replaced by that primitive
- the props line up **exactly**, so no call-site changes, no prop renaming, no shim
- the hand-rolled version adds no behavior the primitive lacks (no extra keyboard
  handling, no extra styling contract, no extra state)
- verification stays green afterwards

Delete the hand-rolled component in the same commit that adopts the primitive. Leaving
the old copy behind defeats the point.

**REPORT**, leave the code alone:

- **`merge` is always REPORT.** Choosing which implementation survives is a design decision.
- **`extract-to-shared` is always REPORT.** Designing a shared component's API is a design decision.
- Any `adopt-primitive` where props don't line up exactly, the hand-rolled version carries
  extra behavior, or the swap would touch call sites.
- Anything you're unsure about.

### 5. Verify, then rank + report

Verify every applied swap with the repo's real CI sequence before keeping it:

```bash
pnpm install --frozen-lockfile
BASE_PATH=/ PORT=8080 pnpm run build
pnpm --filter @workspace/api-server run typecheck:test
pnpm --filter @workspace/api-server run test
```

`typecheck:test` is not optional: the main typecheck excludes `*.test.ts`. If a swap fails
verification, revert that one and move it to REPORT with the exact error.

Know the limit of this gate: a green typecheck and build prove the swap compiles, not that
it still *looks* right, because nothing in CI renders the component. That's why the APPLY bar
is exact prop parity and no extra behavior. When a swap is applied, name the screen the
component appears on so a human can glance at it.

Severity = shared-lines (or usage count) × confidence, cross-feature pairs first.
Write `docs/maintenance/duplicate-components-<YYYY-MM-DD>.md`:

- **Summary line**: total clones, % duplicated, # candidate clusters, # after judgment.
- **Applied**: the hand-rolled component, the primitive that replaced it, why props lined up, the commit.
- **Left for a human**, most-severe first: cluster · files · verdict · target home · effort · confidence · rationale. Note that `merge` and `extract-to-shared` are report-only by policy.
- **`keep` appendix**: dismissed look-alikes + why (so the next run and the next builder don't reopen them).
- Anything reverted, with the exact error. Link the raw `jscpd-report.json` location.

### 6. Handoff

Summarize the top 5 clusters in-session. Offer (do **not** auto-do) to: draft a
Linear ticket body for the top cluster, or a Slack message for the team. Drafts go
to the user for review. This skill does not open tickets, merge, or push to main.
