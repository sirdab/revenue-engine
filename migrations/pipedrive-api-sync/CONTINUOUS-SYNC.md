# Continuous one-way sync (Pipedrive → CRM)

Keeps the CRM continuously up to date with Pipedrive — new and changed deals,
persons, organizations, activities, notes, files, **and deal history** — by
polling only what changed since the last run.

## How it works

```bash
node sync.js --phase=incremental
```

1. Reads the **watermark** (`sync_state.pipedrive_last_sync`); first run defaults
   to the last 24h. Applies a 10-minute overlap so nothing slips through the edge.
2. Pulls only records updated since then (`updated_since` on deals/persons/orgs/
   activities; update_time-sorted scan for leads/notes/files) and upserts them on
   `pipedrive_id` — same mapping, decoders, labels, and relation resolution as the
   full sync.
3. For every **deal that changed**, re-pulls its flow and appends any **new**
   `change_events` (dedupe index drops ones already recorded).
4. Advances the watermark to the run's start time — but **only if the run finished
   cleanly** (if it pauses on the token budget, the window is retried next run).

Everything is idempotent and resumable: re-running is always safe.

## Cost

Tiny. A 15-minute delta is usually a handful of records, so each run is ~15–30 API
calls. Even at 96 runs/day that's a small fraction of the 1.08M daily token budget.

## Schedule it every 15 minutes

### Option 1 — GitHub Actions

A workflow is committed at `.github/workflows/pipedrive-sync.yml`. It runs the
incremental sync on GitHub's infrastructure. It ships with only a manual
trigger; uncomment its `schedule` block to run every 15 minutes. One-time setup:

1. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `PIPEDRIVE_API_TOKEN`
   - `DATABASE_URL` (the same database the app serves)
2. Trigger a run manually with **Run workflow** to test, then enable the schedule.

> Private-repo Actions minutes: a 15-min cadence is ~2,880 short runs/month. To
> stay lighter, use `*/30 * * * *`.

### Option 2 — any scheduler

Run `pnpm sync:pipedrive` (or
`node migrations/pipedrive-api-sync/sync.js --phase=incremental`) from cron, a
Kubernetes CronJob or your platform's scheduled jobs, with `PIPEDRIVE_API_TOKEN`
and `DATABASE_URL` set.

The `sync_state` table is created automatically on first run.

## Manual / ad-hoc

```bash
export PIPEDRIVE_API_TOKEN="..."
export DATABASE_URL="..."
node sync.js --phase=incremental                  # use saved watermark
node sync.js --phase=incremental --since=2026-06-28T00:00:00Z   # explicit window (no milliseconds)
```

## Check it's working

```bash
psql "$DATABASE_URL" -At -c "SELECT key, value FROM sync_state;"        # last sync time
psql "$DATABASE_URL" -At -c "SELECT count(*) FROM change_events;"        # history grows as deals change
```

## Known limitations

- **Deletes/merges aren't propagated.** `updated_since` only returns existing
  records, so a deal deleted in Pipedrive stays in the CRM. If you need that,
  schedule a periodic full reconcile (`--phase=entities`) that can flag records
  whose `pipedrive_id` no longer appears, or handle `is_deleted` — not built yet.
- **Leads** are small (~150) and re-pulled in full each run (the v1 leads endpoint
  doesn't filter by update_time reliably); negligible cost.
- **Teams** are re-pulled in full each run (`/v1/legacyTeams` is a flat list with no
  `updated_since`) and membership (`users.team_id`) is re-asserted from Pipedrive.
  Negligible cost, but note this means a member reassigned **in the CRM** to a
  different team will be reverted on the next sync if Pipedrive still lists them on
  the original team. Team `active`/order edits made in-app are preserved. Requires an
  admin-scoped token; without it the teams step is skipped (logged), not fatal.
- This is **one-way** (Pipedrive → CRM). Edits made in the CRM are not pushed back
  to Pipedrive.
