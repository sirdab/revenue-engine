# Pipedrive → Postgres import

Loads a full Pipedrive export (CSV/XLSX) into the app database, once. For an
ongoing sync from the Pipedrive API, see `../pipedrive-api-sync`.

## Schema
The migrations already include the Pipedrive columns: `pipedrive_id` (unique)
+ `pipedrive_data` (jsonb, the full original record) on `users, pipelines,
stages, organizations, persons, deals, activities, notes`; `lead_id` on
`activities`/`notes`; and the `leads` and `files` tables.

## Import (`import.js`)
Node script (deps: `exceljs`, `papaparse`, `pg`). Reads the Pipedrive CSV/XLSX
exports and **upserts on `pipedrive_id`** (idempotent — safe to re-run). Run:

```
DATABASE_URL=... node import.js --dry-run   # coverage report, no writes
DATABASE_URL=... node import.js             # live load
```

### Relationship resolution
- owner / creator → users (by name or email)
- organization / person / deal / lead references → local id (by Pipedrive id)
- pipeline → by name; stage → by (pipeline + name), falling back to the
  pipeline's first stage, then a global "Imported — Unknown" pipeline/stage.
- Imported users are created **inactive** with a random password — activate via
  an admin password reset.

> Note: the Airbyte sync-metadata columns (Raw ID / Extracted At / Meta /
> Generation ID) are intentionally excluded from `pipedrive_data`.
