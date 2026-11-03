"use strict";
/*
 * Pipedrive REST API -> Postgres full sync.
 *
 * Idempotent upsert on pipedrive_id (re-runnable, resumable). Sources every
 * entity from the API (the authoritative source), decodes custom fields and
 * labels from the live field definitions, resolves all relations via native
 * Pipedrive ids, stores the raw object in <table>.pipedrive_data, and (history
 * phase) reconstructs each deal's timeline from /v1/deals/{id}/flow into
 * change_events.
 *
 * Env:   DATABASE_URL, PIPEDRIVE_API_TOKEN
 * Usage:
 *   node sync.js --dry-run                 # counts only, no writes
 *   node sync.js --phase=entities          # users..files (no history)
 *   node sync.js --phase=history --history=open-won   # timelines for open+won
 *   node sync.js --phase=history --history=lost       # lost deals (background)
 *   node sync.js                           # entities, then open-won history
 *   node sync.js --limit=20                # cap deals per entity (test batch)
 */

// Resolve `pg` portably: the normal require works inside the workspace;
// fall back to the pnpm store path for ad-hoc local runs from this folder.
let pg;
try {
  pg = require("pg");
} catch {
  pg = require(__dirname + "/../../node_modules/.pnpm/pg@8.20.0/node_modules/pg");
}
const { Client } = pg;

const TOKEN = process.env.PIPEDRIVE_API_TOKEN;
const DBURL = process.env.DATABASE_URL;
const BASE = "https://api.pipedrive.com";
const DRY = process.argv.includes("--dry-run");
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const PHASE = arg("phase", "default"); // entities | history | incremental | default(=entities+open-won) | all
const HIST = arg("history", "open-won"); // open-won | lost | all
const LIMIT = Number(arg("limit", "0")) || 0; // 0 = no cap
// Incremental watermark: ISO timestamp, or "auto" (read/advance the saved
// watermark in the sync_state table). Set by the --since flag / incremental phase.
let SINCE = arg("since", null);
const OVERLAP_MIN = 10; // re-scan a small window before the watermark to avoid edge misses
const PIPE_OFFSET = 100000; // local pipeline/stage id = offset + pipedrive id
const FALLBACK_PIPELINE = 999000;
const FALLBACK_STAGE = 999000;
const CHUNK = 400;

if (!TOKEN) throw new Error("PIPEDRIVE_API_TOKEN required");
if (!DRY && !DBURL) throw new Error("DATABASE_URL required");

// ---- value helpers ---------------------------------------------------------
const s = (v) => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  return Number.isFinite(n) ? n : null;
};
const intg = (v) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const ts = (v) => {
  const x = s(v);
  if (!x) return null;
  let iso = x.length === 10 ? x + "T00:00:00Z" : x.replace(" ", "T");
  if (!/[Zz]$|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
  const d = new Date(iso);
  return isNaN(d) ? null : d.toISOString();
};
const dateOnly = (v) => {
  const x = s(v);
  return x ? x.slice(0, 10) : null;
};
const first = (...vals) => {
  for (const v of vals) {
    const x = s(v);
    if (x) return x;
  }
  return null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Postgres text/jsonb cannot store NUL (0x00). Strip it from any string value,
// recursing into arrays. JSON blobs are handled separately (escaped form).
const clean = (v) =>
  typeof v === "string"
    ? v.split(String.fromCharCode(0)).join("")
    : Array.isArray(v)
      ? v.map(clean)
      : v;

// ---- rate-limited API client ----------------------------------------------
let dailyRemaining = Infinity;
const stats = { calls: 0, tokens: 0 };

async function api(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}api_token=${TOKEN}`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      // Ride out network outages / laptop sleep: up to ~15 tries, backoff capped at 30s.
      if (attempt < 15) {
        await sleep(Math.min(30000, 2000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
    const winRem = Number(res.headers.get("x-ratelimit-remaining"));
    const winReset = Number(res.headers.get("x-ratelimit-reset")) || 2;
    const dRem = Number(res.headers.get("x-daily-ratelimit-token-remaining"));
    if (Number.isFinite(dRem)) dailyRemaining = dRem;

    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after")) || winReset || 2;
      await sleep((ra + 1) * 1000);
      continue;
    }
    if (res.status >= 500) {
      if (attempt < 5) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
    }
    const json = await res.json().catch(() => ({}));
    stats.calls++;
    // Stay under the 80-req / 2s burst window.
    if (Number.isFinite(winRem) && winRem <= 3) await sleep((winReset + 1) * 1000);
    if (!res.ok && json && json.success === false) {
      // surface but don't crash the whole run on a single bad record
      return { data: null, error: json.error, _status: res.status };
    }
    return json;
  }
}

// Daily-budget guard for the long history phase. Returns false when we should
// stop and resume on the next budget reset.
function budgetExhausted(costPerCall = 40, safety = 2000) {
  return dailyRemaining <= costPerCall + safety;
}

// v2 cursor pagination
async function* pageV2(entity, extra = "") {
  let cursor = null;
  for (;;) {
    const q = `/api/v2/${entity}?limit=500${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await api(q);
    if (r && r.success === false) throw new Error(`v2 ${entity} query failed: ${r.error}`);
    const data = r.data || [];
    for (const row of data) yield row;
    cursor = r.additional_data && r.additional_data.next_cursor;
    if (!cursor || data.length === 0) break;
  }
}

// v1 offset pagination
async function* pageV1(entity, extra = "") {
  let start = 0;
  for (;;) {
    const q = `/v1/${entity}?start=${start}&limit=500${extra}`;
    const r = await api(q);
    if (r && r.success === false) throw new Error(`v1 ${entity} query failed: ${r.error}`);
    const data = r.data || [];
    for (const row of data) yield row;
    const p = r.additional_data && r.additional_data.pagination;
    if (!p || !p.more_items_in_collection) break;
    start = p.next_start;
  }
}

// Incremental query fragment for v2 collections (updated_since ascending).
const v2Inc = () =>
  SINCE ? `&updated_since=${encodeURIComponent(SINCE)}&sort_by=update_time&sort_direction=asc` : "";

// Since-aware v1 pager: v1 collections have no updated_since, so sort by
// update_time DESC and stop once we cross the watermark. Falls back to a full
// scan when SINCE is null.
async function* pageV1Since(entity) {
  if (!SINCE) {
    yield* pageV1(entity);
    return;
  }
  const cutoff = new Date(SINCE).getTime();
  let start = 0;
  for (;;) {
    const r = await api(`/v1/${entity}?start=${start}&limit=500&sort=${encodeURIComponent("update_time DESC")}`);
    if (r && r.success === false) throw new Error(`v1 ${entity} since-query failed: ${r.error}`);
    const data = r.data || [];
    for (const row of data) {
      const utRaw = row.update_time || row.add_time;
      const ut = utRaw ? new Date(String(utRaw).replace(" ", "T") + "Z").getTime() : 0;
      if (ut && ut < cutoff) return; // sorted desc → everything after is older
      yield row;
    }
    const p = r.additional_data && r.additional_data.pagination;
    if (!p || !p.more_items_in_collection) break;
    start = p.next_start;
  }
}

// ---- DB upsert -------------------------------------------------------------
let client;
async function flush(table, cols, rows, conflictCol, opts = {}) {
  if (DRY || rows.length === 0) return rows.length;
  // Dedupe on the conflict key, keeping the FIRST occurrence. Paged listings
  // can yield the same record twice (v1 update_time-DESC pagination shifts as
  // records change mid-scan), and Postgres rejects an INSERT .. ON CONFLICT
  // DO UPDATE that touches the same row twice in one statement. First-seen is
  // the newest row for the DESC pagers where duplicates actually occur.
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = String(r[conflictCol]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const keepOnUpdate = new Set(opts.coalesce || []); // preserve existing value
  const mergeJsonb = new Set(opts.jsonbMerge || []); // shallow-merge jsonb, keeping existing keys
  const updatable = cols.filter((c) => c !== "id" && c !== conflictCol);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => {
      const ph = cols.map((c) => {
        let v = r[c];
        if ((c === "pipedrive_data" || c === "custom_fields") && v != null && typeof v === "object")
          v = JSON.stringify(v).split("\\u0000").join("");
        else v = clean(v);
        params.push(v === undefined ? null : v);
        return "$" + params.length;
      });
      return "(" + ph.join(",") + ")";
    });
    const setClause = updatable.length
      ? " DO UPDATE SET " +
        updatable
          .map((c) =>
            mergeJsonb.has(c)
              // Preserve user-created custom_fields keys while refreshing the
              // Pipedrive-decoded ones. Double COALESCE is load-bearing: jsonb
              // `x || null` is null, and an empty custom_fields is stored as null.
              ? `${c}=COALESCE(${table}.${c},'{}'::jsonb) || COALESCE(EXCLUDED.${c},'{}'::jsonb)`
              : keepOnUpdate.has(c)
                ? `${c}=COALESCE(${table}.${c}, EXCLUDED.${c})`
                : `${c}=EXCLUDED.${c}`,
          )
          .join(",")
      : " DO NOTHING";
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (${conflictCol})${setClause}`;
    await dbq(sql, params);
  }
  return rows.length;
}

async function loadMap(sql) {
  if (DRY) return new Map();
  const { rows } = await dbq(sql);
  const m = new Map();
  for (const r of rows) m.set(String(r.k), r.v);
  return m;
}

// ---- field definitions / decoders -----------------------------------------
async function loadFieldMeta(entity) {
  // entity: dealFields | personFields | organizationFields | activityFields
  const meta = {}; // hash -> {name, type, options:{id->label}}
  const r = await api(`/v1/${entity}?limit=500`);
  for (const f of r.data || []) {
    const key = f.key || "";
    const options = {};
    for (const o of f.options || []) options[String(o.id)] = o.label;
    meta[key] = { name: f.name, type: f.field_type, options, key };
  }
  return meta;
}

function decodeCustom(value, m) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    // v2 returns objects for monetary/daterange/address/time-range etc.
    if ("value" in value) value = value.value;
    else return value; // store structured value as-is
  }
  if (m.type === "enum") return m.options[String(value)] ?? value;
  if (m.type === "set") {
    const ids = Array.isArray(value) ? value : String(value).split(",");
    return ids.map((id) => m.options[String(String(id).trim())] ?? id);
  }
  if (m.type === "double" || m.type === "monetary") return num(value) ?? value;
  return value;
}

// Decode a v2 custom_fields object {hash: rawValue} -> {name: decoded}
function decodeCustomFields(cf, meta) {
  const out = {};
  if (!cf) return out;
  for (const [hash, raw] of Object.entries(cf)) {
    const m = meta[hash];
    if (!m) continue;
    const dec = decodeCustom(raw, m);
    if (dec === null || (Array.isArray(dec) && dec.length === 0)) continue;
    out[m.name] = dec;
  }
  return out;
}

const log = (...a) => console.log(...a);

// ---- resilient DB layer ----------------------------------------------------
// A long history run can outlive a single TCP connection (Neon idle/timeout,
// network blip). Reconnect + retry transient errors; an idle 'error' listener
// keeps a dropped socket from crashing the process.
async function newClient() {
  const c = new Client({ connectionString: DBURL, keepAlive: true });
  c.on("error", (e) => console.error("pg client error (will reconnect):", e.message));
  await c.connect();
  return c;
}
const TRANSIENT = /ETIMEDOUT|ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|terminat|Connection terminated|socket hang up|server closed|timeout|fetch failed/i;
async function dbq(sql, params) {
  for (let i = 0; ; i++) {
    try {
      return await client.query(sql, params);
    } catch (e) {
      if (i < 6 && TRANSIENT.test(e.message || "")) {
        console.error(`db retry ${i + 1}: ${e.message}`);
        try { await client.end(); } catch (_) {}
        await sleep(1500 * (i + 1));
        client = await newClient();
        continue;
      }
      throw e;
    }
  }
}

// ===========================================================================
async function main() {
  if (!DRY) {
    client = await newClient();
  }
  log(DRY ? "=== DRY RUN (no writes) ===" : "=== LIVE SYNC ===", "phase=", PHASE, "history=", HIST, LIMIT ? `limit=${LIMIT}` : "");

  if (PHASE === "incremental") {
    await syncIncremental();
  } else if (PHASE === "history") {
    await syncHistory();
  } else if (PHASE === "entities") {
    await syncEntities();
  } else if (PHASE === "all") {
    await syncEntities();
    await syncHistory("all");
  } else {
    // default: entities + open-won history
    await syncEntities();
    if (!DRY) await syncHistory("open-won");
  }

  log("\n=== API usage ===", JSON.stringify({ calls: stats.calls, dailyRemaining }));
  if (client) await client.end();
}

// The /v1/legacyTeams member representation is unverified and has varied across
// Pipedrive accounts, so accept every shape it has historically used: a
// `users`/`user_ids` array of ids, or a `members` array of {user_id|id}
// objects. Returns de-duped local-agnostic Pipedrive user ids.
function teamMemberPids(t) {
  const out = [];
  const push = (v) => {
    if (v != null && typeof v === "object") v = v.user_id ?? v.id;
    const n = intg(v);
    if (n != null) out.push(n);
  };
  if (Array.isArray(t.users)) for (const u of t.users) push(u);
  if (Array.isArray(t.user_ids)) for (const u of t.user_ids) push(u);
  if (Array.isArray(t.members)) for (const m of t.members) push(m);
  return [...new Set(out)];
}

// ---- INCREMENTAL AUDIT DIFF (organizations/persons/activities/notes) ------
// Pipedrive has no per-entity "flow"/changelog API for these four entities
// (only deals expose one, see processDealHistory below), so their audit-log
// coverage has to come from a local before/after diff computed here instead.
// This script has no workspace imports (must run standalone via `node
// sync.js`), so this field-key vocabulary is a deliberately duplicated mirror
// of TRACKED_ORG_FIELDS / TRACKED_PERSON_FIELDS / TRACKED_ACTIVITY_FIELDS /
// TRACKED_NOTE_FIELDS in artifacts/api-server/src/lib/change-events.ts — keep
// both lists in sync by hand when a tracked field changes on either side.
// `labels` is deliberately excluded everywhere below: this sync never writes
// that column for organizations/persons, so diffing it would compare a real
// DB value against `undefined` and spuriously flag every row as changed.
const DIFF_FIELDS = {
  organizations: [
    { col: "name", fieldKey: "name" },
    { col: "address", fieldKey: "address" },
    { col: "owner_id", fieldKey: "owner_id", ref: "user" },
  ],
  persons: [
    { col: "name", fieldKey: "name" },
    { col: "phone", fieldKey: "phone" },
    { col: "email", fieldKey: "email" },
    { col: "organization_id", fieldKey: "organization_id", ref: "organization" },
    { col: "owner_id", fieldKey: "owner_id", ref: "user" },
  ],
  activities: [
    { col: "subject", fieldKey: "subject" },
    { col: "type", fieldKey: "type" },
    { col: "done", fieldKey: "done" },
    { col: "due_date", fieldKey: "due_date" },
    { col: "due_time", fieldKey: "due_time" },
    { col: "duration", fieldKey: "duration" },
    { col: "deal_id", fieldKey: "deal_id", ref: "deal" },
    { col: "person_id", fieldKey: "person_id", ref: "person" },
    // NOT aliased to organization_id here — TRACKED_ACTIVITY_FIELDS keeps the
    // raw `org_id` field_key for activities (unlike deals' FIELD_KEY_ALIAS).
    { col: "org_id", fieldKey: "org_id", ref: "organization" },
    { col: "owner_id", fieldKey: "owner_id", ref: "user" },
  ],
  notes: [
    { col: "content", fieldKey: "content" },
    { col: "pinned_to_deal_flag", fieldKey: "pinned_to_deal_flag" },
    { col: "pinned_to_person_flag", fieldKey: "pinned_to_person_flag" },
    { col: "pinned_to_organization_flag", fieldKey: "pinned_to_organization_flag" },
  ],
};
const ENTITY_TYPE_BY_TABLE = {
  organizations: "organization",
  persons: "person",
  activities: "activity",
  notes: "note",
};

// The raw `pg` driver (unlike Drizzle's `mode:"string"` column config, which
// only applies inside Drizzle's own query builder) returns a Postgres `date`
// column as a JS Date object. Normalize both sides to a plain string before
// comparing/snapshotting so due_date doesn't look "changed" on every run.
function normalizeForDiff(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

function diffSnap(field, raw, refMaps) {
  if (raw == null || raw === "") return null;
  if (field.ref) return { id: raw, label: refMaps[field.ref].get(String(raw)) ?? null };
  return { label: String(raw) };
}

function labelFor(table, row) {
  if (table === "activities") return row.subject;
  if (table === "notes") return (row.content || "").slice(0, 80);
  return row.name;
}

async function insertChangeEventRows(events) {
  if (DRY || !events.length) return;
  const cols = ["entity_type", "entity_id", "field_key", "old_value", "new_value", "changed_by", "changed_at", "source"];
  const pgClean = (v) => {
    v = clean(v);
    return typeof v === "string" ? v.split("\\u0000").join("") : v;
  };
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => "(" + cols.map((c) => "$" + params.push(pgClean(r[c]))).join(",") + ")");
    await dbq(
      `INSERT INTO change_events (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (entity_type, entity_id, field_key, changed_at) DO NOTHING`,
      params,
    );
  }
}

// Wraps flush() with before/after diff-logging. `diffLog` is the ONE switch
// that gates this entire feature: false (the default, used by full/reconcile
// phases) is a pure pass-through to flush() with zero extra queries — turning
// this on for a full backfill would synthesize thousands of synthetic diff
// events for pre-existing rows against nothing. Only syncIncremental() passes
// diffLog=true. Every row must carry `pipedrive_id`; rows are looked up by it.
async function diffAndFlush(table, cols, rows, conflictCol, opts, diffLog, refMaps) {
  if (!diffLog || DRY || rows.length === 0) return flush(table, cols, rows, conflictCol, opts);
  // Dedupe the same way flush() now does internally (paged listings can yield
  // the same pipedrive_id twice) — otherwise a duplicate in this batch would
  // be diffed twice against the same "before" row, double-logging one change.
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = String(r[conflictCol]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const fields = DIFF_FIELDS[table];
  const pids = rows.map((r) => r.pipedrive_id);
  const { rows: before } = await dbq(
    `SELECT id, pipedrive_id, ${fields.map((f) => f.col).join(",")} FROM ${table} WHERE pipedrive_id = ANY($1::int[])`,
    [pids],
  );
  const beforeByPid = new Map(before.map((r) => [String(r.pipedrive_id), r]));

  const n = await flush(table, cols, rows, conflictCol, opts);

  // Brand-new rows have no "before" — resolve the id the upsert just assigned
  // so a single "created" marker can be logged instead of per-field diffs
  // (there's no meaningful prior value for a row that didn't exist).
  const newPids = pids.filter((pid) => !beforeByPid.has(String(pid)));
  const idByPid = new Map();
  if (newPids.length) {
    const { rows: idRows } = await dbq(
      `SELECT id, pipedrive_id FROM ${table} WHERE pipedrive_id = ANY($1::int[])`,
      [newPids],
    );
    for (const r of idRows) idByPid.set(String(r.pipedrive_id), r.id);
  }

  const entityType = ENTITY_TYPE_BY_TABLE[table];
  const events = [];
  for (const row of rows) {
    const pid = String(row.pipedrive_id);
    const prior = beforeByPid.get(pid);
    if (!prior) {
      const id = idByPid.get(pid);
      if (id == null) continue;
      events.push({
        entity_type: entityType,
        entity_id: id,
        field_key: "created",
        old_value: null,
        new_value: JSON.stringify({ id, label: labelFor(table, row) }),
        changed_by: null,
        changed_at: row.add_time,
        source: "automation",
      });
      continue;
    }
    for (const f of fields) {
      const oldV = normalizeForDiff(prior[f.col]);
      const newV = normalizeForDiff(row[f.col]);
      if (oldV === newV) continue;
      const oldSnap = diffSnap(f, oldV, refMaps);
      const newSnap = diffSnap(f, newV, refMaps);
      events.push({
        entity_type: entityType,
        entity_id: prior.id,
        field_key: f.fieldKey,
        old_value: oldSnap ? JSON.stringify(oldSnap) : null,
        new_value: newSnap ? JSON.stringify(newSnap) : null,
        changed_by: null,
        changed_at: new Date().toISOString(),
        source: "automation",
      });
    }
  }
  await insertChangeEventRows(events);
  return n;
}

// ---- ENTITIES --------------------------------------------------------------
async function syncEntities({ diffLog = false } = {}) {
  const changedDealPids = []; // pipedrive ids seen this run (drives incremental history)
  // Local-id -> label maps for DIFF_FIELDS ref columns, filled in as each
  // referenced entity finishes its own upsert below (same dependency order
  // the ru/ro/rp/rd pid->id resolvers already rely on). Empty/unused when
  // diffLog is false.
  const refMaps = {};
  // 0) FIELD META
  const dealMeta = await loadFieldMeta("dealFields");
  const personMeta = await loadFieldMeta("personFields");
  const orgMeta = await loadFieldMeta("organizationFields");
  const actMeta = await loadFieldMeta("activityFields");
  // deal label options (id -> name)
  const labelOpts = {};
  for (const m of Object.values(dealMeta))
    if (m.key === "label") Object.assign(labelOpts, m.options);
  log(`field defs: deal=${Object.keys(dealMeta).length} person=${Object.keys(personMeta).length} org=${Object.keys(orgMeta).length} act=${Object.keys(actMeta).length} | dealLabels=${Object.keys(labelOpts).length}`);
  // attribution custom-field names that have native columns (kept out of custom_fields jsonb)
  const ATTR = {
    utm_source: "UTM \\ Source",
    utm_medium: "UTM \\ Medium",
    utm_campaign: "UTM \\ Campaign",
    utm_keyword: "UTM \\ Keyword",
    ad_name: "ad_name",
    gclid: "gclid",
    fbclid: "fbclid",
  };

  // 1) USERS (v1)
  let rows = [];
  for await (const u of pageV1("users")) {
    if (u.is_deleted) continue;
    rows.push({
      name: first(u.name, u.email, "User " + u.id),
      email: (s(u.email) || `pipedrive-${u.id}@imported.local`).toLowerCase(),
      password_hash: "imported:pending-reset",
      is_admin: !!u.is_admin,
      active_flag: !!u.active_flag,
      default_currency: s(u.default_currency) || "SAR",
      timezone_name: s(u.timezone_name) || "Asia/Riyadh",
      created: ts(u.created),
      last_login: ts(u.last_login),
      pipedrive_id: intg(u.id),
      pipedrive_data: u,
    });
  }
  await flush(
    "users",
    ["name", "email", "password_hash", "is_admin", "active_flag", "default_currency", "timezone_name", "created", "last_login", "pipedrive_id", "pipedrive_data"],
    rows,
    "pipedrive_id",
    { coalesce: ["password_hash", "active_flag"] }, // never reset a login on re-sync
  );
  log(`users: ${rows.length}`);
  const userByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM users WHERE pipedrive_id IS NOT NULL");
  const ru = (pid) => (pid == null ? null : userByPid.get(String(pid)) ?? null);
  refMaps.user = diffLog ? await loadMap("SELECT id::text k, name v FROM users") : new Map();

  // 1b) TEAMS (v1 legacyTeams) — ownership grouping. Best-effort: the endpoint
  // needs an admin-scoped token, so a missing/forbidden teams endpoint logs and
  // is skipped, never aborting the wider sync. Upsert on pipedrive_id
  // (idempotent, no duplicates), preserving admin-edited active/order on
  // re-sync. Then wire users.team_id from each team's member list — the first
  // team to claim a user is their primary. Unmatched members (a Pipedrive user
  // with no local row) are collected and logged at run end, never dropped.
  const unmatchedTeamMembers = [];
  {
    const tr = await api("/v1/legacyTeams");
    if (tr && tr.error) {
      log(`teams: SKIPPED (${tr.error}) — needs an admin-scoped token`);
    } else {
      // Drop teams without a numeric id: the upsert conflicts on pipedrive_id,
      // and Postgres treats every NULL as distinct, so a null-id team would
      // insert a fresh duplicate row on every run. Sort deterministically
      // (order, then id) so "first team wins" for a multi-team member is stable
      // across runs regardless of Pipedrive's response ordering.
      const teamList = (Array.isArray(tr && tr.data) ? tr.data : [])
        .filter((t) => intg(t.id) != null)
        .sort(
          (a, b) =>
            (intg(a.order_nr) ?? 0) - (intg(b.order_nr) ?? 0) ||
            intg(a.id) - intg(b.id),
        )
        .slice(0, LIMIT || undefined);
      rows = teamList.map((t) => ({
        name: first(s(t.name), "Team " + t.id),
        active: t.active_flag === false || t.deleted === true ? false : true,
        order_index: intg(t.order_nr) ?? 0,
        pipedrive_id: intg(t.id),
        pipedrive_data: t,
      }));
      await flush(
        "teams",
        ["name", "active", "order_index", "pipedrive_id", "pipedrive_data"],
        rows,
        "pipedrive_id",
        { coalesce: ["active", "order_index"] }, // keep admin archive/reorder on re-sync
      );
      log(`teams: ${rows.length}`);

      if (!DRY && teamList.length) {
        const teamByPid = await loadMap(
          "SELECT pipedrive_id::text k, id v FROM teams WHERE pipedrive_id IS NOT NULL",
        );
        const assigned = new Set(); // local user id -> first team wins (primary)
        for (const t of teamList) {
          const localTeam = teamByPid.get(String(t.id));
          if (localTeam == null) continue;
          for (const pid of teamMemberPids(t)) {
            const localUser = ru(pid);
            if (localUser == null) {
              unmatchedTeamMembers.push({ teamPid: t.id, userPid: pid });
              continue;
            }
            if (assigned.has(localUser)) continue;
            assigned.add(localUser);
            await dbq("UPDATE users SET team_id = $1 WHERE id = $2", [
              localTeam,
              localUser,
            ]);
          }
        }
        log(`teams: wired ${assigned.size} member${assigned.size === 1 ? "" : "s"}`);
      }
    }
  }

  // 2) PIPELINES (v1) — local id = OFFSET + pid
  rows = [];
  const validPipe = new Set([FALLBACK_PIPELINE]);
  for await (const p of pageV1("pipelines")) {
    validPipe.add(PIPE_OFFSET + intg(p.id));
    rows.push({ id: PIPE_OFFSET + intg(p.id), name: s(p.name) || "Pipeline " + p.id, pipedrive_id: intg(p.id), pipedrive_data: p });
  }
  if (!DRY) {
    await dbq(`INSERT INTO pipelines (id,name) VALUES ($1,'Imported — Unknown') ON CONFLICT (id) DO NOTHING`, [FALLBACK_PIPELINE]);
    await dbq(`INSERT INTO stages (id,name,pipeline_id,probability) VALUES ($1,'Imported — Unknown',$2,0) ON CONFLICT (id) DO NOTHING`, [FALLBACK_STAGE, FALLBACK_PIPELINE]);
  }
  await flush("pipelines", ["id", "name", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id");
  log(`pipelines: ${rows.length}`);

  // 3) STAGES (v1) — local id = OFFSET + pid
  rows = [];
  const validStage = new Set();
  const pipeFirstStage = new Map(); // localPipe -> first (lowest-order) localStage
  const pipeMinOrder = new Map();
  for await (const st of pageV1("stages")) {
    const local = PIPE_OFFSET + intg(st.id);
    const localPipe = PIPE_OFFSET + intg(st.pipeline_id);
    const order = intg(st.order_nr) ?? 0;
    validStage.add(local);
    const cur = pipeMinOrder.get(localPipe);
    if (cur == null || order < cur) {
      pipeMinOrder.set(localPipe, order);
      pipeFirstStage.set(localPipe, local);
    }
    rows.push({
      id: local,
      name: s(st.name) || "Stage " + st.id,
      pipeline_id: localPipe,
      order_index: order,
      probability: intg(st.deal_probability) ?? 100,
      rotting_days: intg(st.days_to_rotten),
      pipedrive_id: intg(st.id),
      pipedrive_data: st,
    });
  }
  await flush("stages", ["id", "name", "pipeline_id", "order_index", "probability", "rotting_days", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id");
  validStage.add(FALLBACK_STAGE);
  // Deleted/archived stages aren't returned by /v1/stages but old deals still
  // point at them — keep such deals in the right pipeline by falling back to its
  // first stage (or the global fallback when even the pipeline is gone).
  const resolveStage = (stagePid, localPipe) => {
    const local = stagePid == null ? null : PIPE_OFFSET + intg(stagePid);
    if (local != null && validStage.has(local)) return local;
    return pipeFirstStage.get(localPipe) ?? FALLBACK_STAGE;
  };
  log(`stages: ${rows.length}`);

  // 4) ORGANIZATIONS (v2)
  rows = [];
  let n = 0;
  const flushOrgs = async () => {
    n += await diffAndFlush("organizations", ["name", "address", "owner_id", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id", {}, diffLog, refMaps);
    rows = [];
  };
  for await (const o of pageV2("organizations", v2Inc())) {
    if (o.is_deleted) continue;
    const addr = o.address && typeof o.address === "object" ? o.address.value : o.address;
    rows.push({
      name: first(o.name, "Organization " + o.id),
      address: s(addr),
      owner_id: ru(o.owner_id),
      add_time: ts(o.add_time) || new Date().toISOString(),
      pipedrive_id: intg(o.id),
      pipedrive_data: o,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushOrgs();
  }
  await flushOrgs();
  log(`organizations: ${n}`);
  const orgByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM organizations WHERE pipedrive_id IS NOT NULL");
  const ro = (pid) => (pid == null ? null : orgByPid.get(String(pid)) ?? null);
  refMaps.organization = diffLog ? await loadMap("SELECT id::text k, name v FROM organizations") : new Map();

  // 5) PERSONS (v2)
  rows = [];
  n = 0;
  const flushPeople = async () => {
    n += await diffAndFlush("persons", ["name", "phone", "email", "organization_id", "owner_id", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id", {}, diffLog, refMaps);
    rows = [];
  };
  const primary = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    return s((arr.find((x) => x.primary) || arr[0]).value);
  };
  for await (const p of pageV2("persons", v2Inc())) {
    if (p.is_deleted) continue;
    rows.push({
      name: first(p.name, p.first_name, primary(p.emails), "Person " + p.id),
      phone: primary(p.phones),
      email: primary(p.emails),
      organization_id: ro(p.org_id),
      owner_id: ru(p.owner_id),
      add_time: ts(p.add_time) || new Date().toISOString(),
      pipedrive_id: intg(p.id),
      pipedrive_data: p,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushPeople();
  }
  await flushPeople();
  log(`persons: ${n}`);
  const personByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM persons WHERE pipedrive_id IS NOT NULL");
  const rp = (pid) => (pid == null ? null : personByPid.get(String(pid)) ?? null);
  refMaps.person = diffLog ? await loadMap("SELECT id::text k, name v FROM persons") : new Map();

  // 6) DEALS (v2) — custom fields + labels + attribution
  const STATUS = { open: "open", won: "won", lost: "lost", deleted: "deleted" };
  rows = [];
  n = 0;
  const flushDeals = async () => {
    n += await flush(
      "deals",
      ["title", "value", "currency", "status", "owner_id", "creator_user_id", "person_id", "organization_id", "pipeline_id", "stage_id", "visible_to", "lost_reason", "comments", "expected_close_date", "labels", "utm_source", "utm_medium", "utm_campaign", "utm_keyword", "ad_name", "gclid", "fbclid", "add_time", "stage_change_time", "won_time", "lost_time", "close_time", "custom_fields", "pipedrive_id", "pipedrive_data"],
      rows,
      "pipedrive_id",
      { jsonbMerge: ["custom_fields"] },
    );
    rows = [];
  };
  for await (const d of pageV2("deals", v2Inc())) {
    changedDealPids.push(intg(d.id));
    const cf = decodeCustomFields(d.custom_fields, dealMeta);
    // pull attribution into native columns, then drop from the jsonb blob
    const attr = {};
    for (const [col, name] of Object.entries(ATTR)) {
      const v = cf[name];
      attr[col] = v == null ? null : Array.isArray(v) ? v.join(", ") : String(v);
      delete cf[name];
    }
    const labels = (d.label_ids || []).map((id) => labelOpts[String(id)] ?? String(id));
    const comments = cf["Comments"] != null ? String(cf["Comments"]) : null;
    let localPipe = d.pipeline_id != null ? PIPE_OFFSET + intg(d.pipeline_id) : FALLBACK_PIPELINE;
    if (!validPipe.has(localPipe)) localPipe = FALLBACK_PIPELINE;
    const localStage = resolveStage(d.stage_id, localPipe);
    rows.push({
      title: first(d.title, "Deal " + d.id),
      value: num(d.value) ?? 0,
      currency: s(d.currency) || "SAR",
      status: STATUS[(s(d.status) || "open").toLowerCase()] || "open",
      owner_id: ru(d.owner_id),
      creator_user_id: ru(d.creator_user_id),
      person_id: rp(d.person_id),
      organization_id: ro(d.org_id),
      pipeline_id: localPipe,
      stage_id: localStage,
      visible_to: d.visible_to == null ? null : String(d.visible_to),
      lost_reason: s(d.lost_reason),
      comments,
      expected_close_date: dateOnly(d.expected_close_date),
      labels: labels.length ? labels : null,
      utm_source: attr.utm_source,
      utm_medium: attr.utm_medium,
      utm_campaign: attr.utm_campaign,
      utm_keyword: attr.utm_keyword,
      ad_name: attr.ad_name,
      gclid: attr.gclid,
      fbclid: attr.fbclid,
      add_time: ts(d.add_time) || new Date().toISOString(),
      stage_change_time: ts(d.stage_change_time),
      won_time: ts(d.won_time),
      lost_time: ts(d.lost_time),
      close_time: ts(d.close_time),
      custom_fields: Object.keys(cf).length ? cf : null,
      pipedrive_id: intg(d.id),
      pipedrive_data: d,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushDeals();
  }
  await flushDeals();
  log(`deals: ${n}`);
  const dealByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM deals WHERE pipedrive_id IS NOT NULL");
  const rd = (pid) => (pid == null ? null : dealByPid.get(String(pid)) ?? null);
  refMaps.deal = diffLog ? await loadMap("SELECT id::text k, title v FROM deals") : new Map();

  // 7) LEADS (v1, UUID ids)
  const leadLabelMap = {};
  {
    const r = await api("/v1/leadLabels");
    for (const o of r.data || []) leadLabelMap[o.id] = o.name;
  }
  rows = [];
  n = 0;
  const flushLeads = async () => {
    n += await flush("leads", ["title", "value", "currency", "owner_id", "person_id", "organization_id", "source_name", "labels", "expected_close_date", "archive_time", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id");
    rows = [];
  };
  for await (const l of pageV1Since("leads")) {
    const labels = (l.label_ids || []).map((id) => leadLabelMap[id] ?? id).join(", ") || null;
    rows.push({
      title: first(l.title, "Lead"),
      value: l.value ? num(l.value.amount) : null,
      currency: l.value ? s(l.value.currency) : null,
      owner_id: ru(l.owner_id),
      person_id: rp(l.person_id),
      organization_id: ro(l.organization_id),
      source_name: s(l.source_name),
      labels,
      expected_close_date: dateOnly(l.expected_close_date),
      archive_time: ts(l.archive_time),
      add_time: ts(l.add_time) || new Date().toISOString(),
      pipedrive_id: s(l.id),
      pipedrive_data: l,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushLeads();
  }
  await flushLeads();
  log(`leads: ${n}`);
  const leadByPid = await loadMap("SELECT pipedrive_id k, id v FROM leads WHERE pipedrive_id IS NOT NULL");
  const rl = (pid) => (pid == null ? null : leadByPid.get(String(pid)) ?? null);

  // 8) ACTIVITIES (v2)
  const ATYPE = new Set(["call", "meeting", "email", "task", "deadline"]);
  rows = [];
  n = 0;
  const flushActs = async () => {
    n += await diffAndFlush("activities", ["subject", "type", "note", "done", "busy", "due_date", "due_time", "duration", "marked_as_done_time", "deal_id", "person_id", "org_id", "lead_id", "owner_id", "creator_user_id", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id", {}, diffLog, refMaps);
    rows = [];
  };
  for await (const a of pageV2("activities", v2Inc())) {
    if (a.is_deleted) continue;
    const t = (s(a.type) || "task").toLowerCase();
    rows.push({
      subject: first(a.subject, a.type, "Activity " + a.id),
      type: ATYPE.has(t) ? t : "task",
      note: first(a.note, a.public_description),
      done: !!a.done,
      busy: !!a.busy,
      due_date: dateOnly(a.due_date),
      due_time: s(a.due_time),
      duration: s(a.duration),
      marked_as_done_time: ts(a.marked_as_done_time),
      deal_id: rd(a.deal_id),
      person_id: rp(a.person_id),
      org_id: ro(a.org_id),
      lead_id: rl(a.lead_id),
      owner_id: ru(a.owner_id),
      creator_user_id: ru(a.creator_user_id),
      add_time: ts(a.add_time) || new Date().toISOString(),
      pipedrive_id: intg(a.id),
      pipedrive_data: a,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushActs();
  }
  await flushActs();
  log(`activities: ${n}`);

  // 9) NOTES (v1)
  rows = [];
  n = 0;
  const flushNotes = async () => {
    n += await diffAndFlush("notes", ["content", "deal_id", "person_id", "org_id", "lead_id", "user_id", "pinned_to_deal_flag", "pinned_to_person_flag", "pinned_to_organization_flag", "pinned_to_lead_flag", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id", {}, diffLog, refMaps);
    rows = [];
  };
  for await (const nt of pageV1Since("notes")) {
    rows.push({
      content: s(nt.content) || "",
      deal_id: rd(nt.deal_id),
      person_id: rp(nt.person_id),
      org_id: ro(nt.org_id),
      lead_id: rl(nt.lead_id),
      user_id: ru(nt.user_id),
      pinned_to_deal_flag: !!nt.pinned_to_deal_flag,
      pinned_to_person_flag: !!nt.pinned_to_person_flag,
      pinned_to_organization_flag: !!nt.pinned_to_organization_flag,
      pinned_to_lead_flag: !!nt.pinned_to_lead_flag,
      add_time: ts(nt.add_time) || new Date().toISOString(),
      pipedrive_id: intg(nt.id),
      pipedrive_data: nt,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushNotes();
  }
  await flushNotes();
  log(`notes: ${n}`);

  // 10) FILES (v1)
  rows = [];
  n = 0;
  const flushFiles = async () => {
    n += await flush("files", ["file_name", "file_type", "download_url", "description", "deal_id", "person_id", "org_id", "lead_id", "user_id", "add_time", "pipedrive_id", "pipedrive_data"], rows, "pipedrive_id");
    rows = [];
  };
  for await (const f of pageV1Since("files")) {
    rows.push({
      file_name: s(f.file_name) || s(f.name),
      file_type: s(f.file_type),
      download_url: s(f.url),
      description: s(f.description),
      deal_id: rd(f.deal_id),
      person_id: rp(f.person_id),
      org_id: ro(f.org_id),
      lead_id: rl(f.lead_id),
      user_id: ru(f.user_id),
      add_time: ts(f.add_time),
      pipedrive_id: intg(f.id),
      pipedrive_data: f,
    });
    if (LIMIT && n + rows.length >= LIMIT) break;
    if (rows.length >= CHUNK) await flushFiles();
  }
  await flushFiles();
  log(`files: ${n}`);

  // Prominent, non-fatal report of Pipedrive team members we couldn't match to
  // a local user. They stay in teams.pipedrive_data for later reconciliation;
  // the sync itself succeeds regardless.
  if (unmatchedTeamMembers.length) {
    log("");
    log(`⚠ teams: ${unmatchedTeamMembers.length} member(s) had no local user and were left unassigned:`);
    for (const u of unmatchedTeamMembers) {
      log(`    team pipedrive_id=${u.teamPid} → user pipedrive_id=${u.userPid}`);
    }
    log("  (retained in teams.pipedrive_data — reconcile once the users exist)");
  }

  return { changedDealPids };
}

// ---- HISTORY (deal flow -> change_events) ---------------------------------
// The Pipedrive deal-flow field_keys we backfill. Kept in sync with the app's
// TRACKED_DEAL_FIELDS (artifacts/api-server/src/lib/change-events.ts) so an
// imported deal's history has the same breadth as one managed in the app.
const TRACKED = new Set([
  "stage_id", "owner_id", "pipeline_id", "person_id", "org_id",
  "value", "currency", "status", "title", "expected_close_date",
  "lost_reason", "visible_to",
]);

// Pipedrive uses `org_id`; our canonical field_key (matching the deals column
// and the app logger) is `organization_id`. Normalize so both sources line up
// in a single timeline.
const FIELD_KEY_ALIAS = { org_id: "organization_id" };

// Resolution maps used to label history snapshots (pipedrive id -> id/name).
async function loadHistMaps() {
  return {
    userByPid: await loadMap("SELECT pipedrive_id::text k, id v FROM users WHERE pipedrive_id IS NOT NULL"),
    userName: await loadMap("SELECT pipedrive_id::text k, name v FROM users WHERE pipedrive_id IS NOT NULL"),
    stageName: await loadMap("SELECT pipedrive_id::text k, name v FROM stages WHERE pipedrive_id IS NOT NULL"),
    pipeName: await loadMap("SELECT pipedrive_id::text k, name v FROM pipelines WHERE pipedrive_id IS NOT NULL"),
    personByPid: await loadMap("SELECT pipedrive_id::text k, id v FROM persons WHERE pipedrive_id IS NOT NULL"),
    personName: await loadMap("SELECT pipedrive_id::text k, name v FROM persons WHERE pipedrive_id IS NOT NULL"),
    orgByPid: await loadMap("SELECT pipedrive_id::text k, id v FROM organizations WHERE pipedrive_id IS NOT NULL"),
    orgName: await loadMap("SELECT pipedrive_id::text k, name v FROM organizations WHERE pipedrive_id IS NOT NULL"),
  };
}

// Pull each deal's flow and upsert its change_events. Idempotent: the dedupe
// index drops events already recorded, so re-running a changed deal only adds
// the NEW timeline entries. `deals`: rows of {id, pipedrive_id, title, add_time}.
async function processDealHistory(deals, maps, labelTag) {
  const { userByPid, userName, stageName, pipeName, personByPid, personName, orgByPid, orgName } = maps;
  const snapStage = (raw) => (raw == null ? null : { id: PIPE_OFFSET + intg(raw), label: stageName.get(String(raw)) ?? null });
  const snapUser = (raw) => (raw == null ? null : { id: userByPid.get(String(raw)) ?? null, label: userName.get(String(raw)) ?? null });
  const snapPipe = (raw) => (raw == null ? null : { id: PIPE_OFFSET + intg(raw), label: pipeName.get(String(raw)) ?? null });
  const snapPerson = (raw) => (raw == null ? null : { id: personByPid.get(String(raw)) ?? null, label: personName.get(String(raw)) ?? null });
  const snapOrg = (raw) => (raw == null ? null : { id: orgByPid.get(String(raw)) ?? null, label: orgName.get(String(raw)) ?? null });
  const snapPlain = (raw) => (raw == null || raw === "" ? null : { label: String(raw) });
  // `field` is the canonical (aliased) field_key.
  const snap = (field, raw) =>
    field === "stage_id" ? snapStage(raw)
      : field === "owner_id" ? snapUser(raw)
      : field === "pipeline_id" ? snapPipe(raw)
      : field === "person_id" ? snapPerson(raw)
      : field === "organization_id" ? snapOrg(raw)
      : snapPlain(raw);

  let processed = 0,
    events = 0,
    paused = false;
  for (const d of deals) {
    if (budgetExhausted()) {
      paused = true;
      break;
    }
    // fetch full flow (paginate)
    const evs = [];
    let start = 0;
    for (;;) {
      const r = await api(`/v1/deals/${d.pipedrive_id}/flow?start=${start}&limit=100`);
      for (const item of r.data || []) if (item.object === "dealChange") evs.push(item.data);
      const p = r.additional_data && r.additional_data.pagination;
      if (!p || !p.more_items_in_collection) break;
      start = p.next_start;
    }
    // build change_events rows
    const rows = [];
    // creation marker at add_time
    rows.push({
      entity_type: "deal",
      entity_id: d.id,
      field_key: "created",
      old_value: null,
      new_value: JSON.stringify({ id: d.id, label: d.title }),
      changed_by: null,
      changed_at: d.add_time,
      source: "import",
    });
    for (const e of evs) {
      const fk = e.field_key;
      if (!TRACKED.has(fk)) continue;
      const at = ts(e.log_time);
      if (!at) continue;
      const canon = FIELD_KEY_ALIAS[fk] ?? fk;
      rows.push({
        entity_type: "deal",
        entity_id: d.id,
        field_key: canon,
        old_value: snap(canon, e.old_value) ? JSON.stringify(snap(canon, e.old_value)) : null,
        new_value: snap(canon, e.new_value) ? JSON.stringify(snap(canon, e.new_value)) : null,
        changed_by: userByPid.get(String(e.user_id)) ?? null,
        changed_at: at,
        source: "import",
      });
    }
    // batch insert with dedupe (idempotent / resumable)
    if (!DRY && rows.length) {
      const cols = ["entity_type", "entity_id", "field_key", "old_value", "new_value", "changed_by", "changed_at", "source"];
      const params = [];
      const pgClean = (v) => {
        v = clean(v);
        return typeof v === "string" ? v.split("\\u0000").join("") : v;
      };
      const tuples = rows.map(
        (r) => "(" + cols.map((c) => "$" + params.push(pgClean(r[c]))).join(",") + ")",
      );
      await dbq(
        `INSERT INTO change_events (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (entity_type, entity_id, field_key, changed_at) DO NOTHING`,
        params,
      );
    }
    events += rows.length;
    processed++;
    if (processed % 200 === 0) log(`  ...${processed}/${deals.length} deals, ${events} events, tokens left=${dailyRemaining}`);
  }
  log(`history(${labelTag}): processed=${processed} events=${events}${paused ? " [PAUSED: daily token budget reached — resume after reset]" : " [DONE]"}`);
  return { processed, events, paused };
}

// Bulk history backfill (open-won / lost / all). Skips deals that already have
// any events (resume), so it never re-pulls a finished deal.
async function syncHistory(which = HIST) {
  const maps = await loadHistMaps();
  const statusFilter =
    which === "open-won" ? "AND status IN ('open','won')" : which === "lost" ? "AND status='lost'" : "";
  const { rows: deals } = await dbq(
    `SELECT id, pipedrive_id, title, add_time, stage_id
       FROM deals
      WHERE pipedrive_id IS NOT NULL ${statusFilter}
        AND NOT EXISTS (SELECT 1 FROM change_events ce WHERE ce.entity_type='deal' AND ce.entity_id=deals.id)
      ORDER BY (status='open') DESC, (status='won') DESC, pipedrive_id DESC
      ${LIMIT ? `LIMIT ${LIMIT}` : ""}`,
  );
  log(`history(${which}): ${deals.length} deals to process; daily tokens left=${dailyRemaining}`);
  return processDealHistory(deals, maps, which);
}

// ---- INCREMENTAL (delta poll) ---------------------------------------------
// Pull only what changed since the saved watermark, upsert it, and refresh the
// timeline for any deal that changed. Designed to run on a schedule (e.g. every
// 15 min). Watermark is persisted in the sync_state table; an overlap window
// guards against edge misses, and all writes are idempotent.
async function ensureSyncState() {
  if (DRY) return;
  await dbq(
    `CREATE TABLE IF NOT EXISTS sync_state (key text PRIMARY KEY, value timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  );
}
async function getWatermark() {
  const { rows } = await dbq("SELECT value FROM sync_state WHERE key='pipedrive_last_sync'");
  return rows[0] ? new Date(rows[0].value) : null;
}
async function setWatermark(d) {
  if (DRY) return;
  await dbq(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('pipedrive_last_sync', $1, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [d.toISOString()],
  );
}

async function syncIncremental() {
  await ensureSyncState();
  const runStart = new Date(); // capture BEFORE pulling, so we never miss a concurrent edit
  // Resolve the watermark: explicit --since wins; else saved state; else last 24h.
  let since;
  if (SINCE && SINCE !== "auto") since = new Date(SINCE);
  else {
    const wm = await getWatermark();
    since = wm ? new Date(wm.getTime() - OVERLAP_MIN * 60000) : new Date(Date.now() - 24 * 3600 * 1000);
  }
  // Pipedrive's updated_since rejects milliseconds — use second-precision ISO.
  SINCE = since.toISOString().replace(/\.\d{3}Z$/, "Z"); // drives v2Inc()/pageV1Since()
  log(`=== INCREMENTAL since ${SINCE} (run start ${runStart.toISOString()}) ===`);

  const { changedDealPids } = await syncEntities({ diffLog: true });
  const pids = [...new Set(changedDealPids.filter((x) => x != null))];
  log(`entities updated; ${pids.length} deals changed -> refreshing timelines`);

  let paused = false;
  if (pids.length) {
    const maps = await loadHistMaps();
    const { rows: deals } = await dbq(
      `SELECT id, pipedrive_id, title, add_time FROM deals WHERE pipedrive_id = ANY($1::int[])`,
      [pids],
    );
    ({ paused } = await processDealHistory(deals, maps, "incremental"));
  }
  // Only advance the watermark when the run fully completed; otherwise the next
  // run re-scans this window (idempotent) and finishes the deferred history.
  if (!paused) {
    await setWatermark(runStart);
    log(`=== INCREMENTAL done; watermark -> ${runStart.toISOString()} ===`);
  } else {
    log(`=== INCREMENTAL paused on token budget; watermark NOT advanced (will retry) ===`);
  }
}

main().catch((e) => {
  console.error("SYNC ERROR:", e.stack || e.message);
  process.exit(1);
});
