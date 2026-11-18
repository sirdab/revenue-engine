---
name: review-code-smells
description: Review code for AI-slop smells (silent error-swallowing, needless defensive code, hollow tests, shallow or premature abstractions), fix the clear mechanical cases, and report the rest. Use for code-quality review, "is this AI slop", or a scheduled quality routine. Applies only needless-defensive-code and single-caller pass-through cleanups; error-swallowing and hollow tests are always report-only.
---

# Review code smells (slop-guard)

Fast LLM-assisted output accretes a specific kind of debt: code that *looks*
careful but buries logic and hides bugs. A linter can't judge this — it needs a
reader with taste. That reader is you. This is a pure-judgment skill; the value is
in **restraint** — a handful of real findings, not a wall of nitpicks.

## The four lenses

### 1. Silent error-swallowing — the priority (correctness, not style)
Failures that never surface. These hide real bugs — rank them first.
- empty `catch {}`; `catch (e) {}` that does nothing.
- `catch { return [] }` / `return null` / `return {}` — the caller can't tell
  "no data" from "it broke". **The especially nasty one.**
- `.catch(() => [])` / `.catch(() => {})` on promises.
- a catch that only `console.log`s and then continues as if nothing failed.
- swallowing then returning a default that flows into business logic.

For each: name **the concrete failure it hides** and what the caller should see
instead (propagate, surface a typed error, or an explicit empty-vs-error result).
Legit: retries with backoff, genuinely-optional best-effort side effects (already
logged), cleanup paths — say why it's legit and move on.

### 2. Needless defensive code
Defense against states that can't happen — it buries the real path.
- try/catch around code that cannot throw (pure sync, no I/O).
- null/undefined checks on values the types already guarantee non-null.
- validation the type system or an upstream guard already enforces.
- `x?.y?.z` chains where the shape is known-present.
Legit and NOT a smell: validating external input (network, parsing, user data,
env). Only flag defense against *internally-impossible* states.

### 3. Hollow tests
Tests that would pass even if the code under test were deleted.
- assert nothing meaningful (`expect(true).toBe(true)`, no assertions).
- mock the unit under test, then assert on the mock.
- snapshot-only tests of trivial/volatile output.
- tests that exercise no branch of the real logic.
Ask of each test: "if I broke the feature, would this go red?" If no → flag.

### 4. Shallow / premature abstractions
Structure imitating "good architecture" without earning it.
- wrapper functions that only call through, adding no behavior/naming value.
- single-use "generic" helpers, factories/strategies built for one caller.
- indirection that makes the reader jump files for nothing.
Legit: an abstraction with ≥2 real callers, or a genuine seam (I/O boundary,
test seam). Default to leaving it unless the no-value case is clear.

## Workflow

### 1. Cheap signal to prioritize the read (not the verdict)
```bash
grep -rnE 'catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*\}|catch[[:space:]]*\{|\.catch\([[:space:]]*\(\)[[:space:]]*=>|return[[:space:]]+(\[\]|null|\{\})[[:space:]]*;?[[:space:]]*\}' \
  <target> --include=*.ts --include=*.tsx
```
Grep only *routes attention*; every hit still needs reading — plenty are fine.

### 2. Judge, with restraint
Read each suspect in context. Record only findings you're confident about:
file:line · lens · the smell · **why it's harmful (esp. the bug it hides)** ·
severity (high = hides a bug / silent failure; med = buries logic; low = clutter)
· a concrete one-line fix. When unsure, drop it. A false alarm wastes a builder's
afternoon and trains people to ignore the routine, and a false *fix* is worse.

### 3. Sort into APPLY and REPORT

**APPLY**, fix it yourself. Only two of the four lenses, and only the clear cases:

- **Needless defensive code (lens 2).** A try/catch around code that genuinely cannot
  throw, or a null check on a value the types already guarantee non-null. You must be
  able to state why from the types alone.
- **A pass-through wrapper (lens 4) with exactly one caller and no test seam.** Inline
  it at that call site and delete the wrapper. Two or more callers, an I/O boundary, or
  anything that stubs or spies on it means REPORT.

**REPORT**, leave the code alone:

- **Silent error-swallowing (lens 1) is always REPORT.** Turning a swallow into a throw
  changes runtime behavior, which is the operator's call, not the routine's. True even
  when the fix looks obvious.
- **Hollow tests (lens 3) are always REPORT.** Deleting or rewriting a test is never
  mechanical.
- Any lens 2 case where impossibility can't be proven from the types, any wrapper with
  more than one caller, and anything you're unsure about.

### 4. Verify, then report

Verify every applied fix with the repo's real CI sequence before keeping it:

```bash
pnpm install --frozen-lockfile
BASE_PATH=/ PORT=8080 pnpm run build
pnpm --filter @workspace/api-server run typecheck:test
pnpm --filter @workspace/api-server run test
```

`typecheck:test` is not optional, and it matters most here: the main typecheck excludes
`*.test.ts`, so inlining a wrapper that a test imported will look fine without it. If a
fix fails verification, revert that one and move it to REPORT with the exact error.

Write `docs/maintenance/code-smells-<YYYY-MM-DD>.md`: counts by lens, then findings
**high-severity first**, error-swallowing at the top. Separate what was applied (with
why it was safe, and the commit) from what was left for a human. Say explicitly that
error-swallowing and hollow tests are report-only by policy, so their presence in the
report isn't read as the routine missing them. List anything reverted.

## Incremental mode (for the nightly routine)
Scope to `git diff` over the last 24h (`git log --since="24 hours ago"`). Review
only added/changed lines in that window (plus enough surrounding context to judge).
Nothing changed, or nothing real found → report "clean" and stop. The point is to
catch slop *as it lands*, in the day's PRs, not to re-audit the backlog nightly.
