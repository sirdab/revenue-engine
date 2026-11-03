# i18n migration tooling

Used to move the frontend's English strings into `lib/i18n/{en,ar}.json`.

- `codemod.ts` — `scan <file>` lists candidate strings; `apply <job.json>`
  rewrites JSX text / string props to `t("key")`, inserts `useI18n()` in the
  enclosing component, and merges keys into both dictionaries (Arabic must be
  supplied; the plural helper in `job.py` feeds all six Arabic categories).
- `drift.py` — wording drift between the dictionaries: the same English label
  rendered two ways in Arabic, plus values that were never translated. What
  the parity test cannot decide, because it needs a human to say whether two
  renderings are correct disambiguation or one feature named twice. See
  `docs/i18n/arabic-review-checklist.md`.
- `job.py` — a thin Python wrapper: `run(file, strings, edits, keys)`,
  `edit(file, (old, new)…)`, `plural(...)`.

Run from `artifacts/login` with `npx tsx ../../scripts/i18n/codemod.ts …`,
or `PYTHONPATH=scripts/i18n python3 - <<EOF … EOF` for `job.py`.

Both resolve the repo from their own location, so they work in any checkout.
Note that `scan` writes its errors to stderr and nothing to stdout when it
fails: a caller that redirects stderr sees an empty result, which reads as
"no strings left" rather than as a failure. Check the exit code, or run a
scan without redirecting, before believing a file is done.
