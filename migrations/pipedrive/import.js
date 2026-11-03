"use strict";
// Pipedrive -> Postgres importer. Idempotent upsert on pipedrive_id.
// Resolves every relationship; stores the full original record in pipedrive_data.
const { Client } = require("pg");
const ExcelJS = require("exceljs");
const Papa = require("papaparse");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DRY = process.argv.includes("--dry-run");
const D = "/Users/sal_zahri/Downloads";
const URL = process.env.DATABASE_URL;
const PIPE_OFFSET = 100000; // local pipeline/stage id = offset + pipedrive id
const FALLBACK_PIPELINE = 999000;
const FALLBACK_STAGE = 999000;
const CHUNK = 400;
const AIRBYTE = new Set(["Airbyte Raw ID", "Airbyte Extracted At", "Airbyte Meta", "Airbyte Generation ID"]);

const F = {
  users: "pipedrive_users.csv",
  pipelines: "pipelines.csv",
  stages: "Stages.csv",
  orgs: "organizations-14651358-540.xlsx",
  people: "people-14651358-541.xlsx",
  deals: "deals-14651358-539.xlsx",
  leads: "leads-14651358-538.xlsx",
  activities: "activities-14651358-542.xlsx",
  notes: "notes-14651358-543.xlsx",
  files: "files-14651358-544.xlsx",
};

// ---- value helpers ----------------------------------------------------------
const s = (v) => { if (v == null) return null; const t = String(v).trim(); return t === "" ? null : t; };
const num = (v) => { const x = s(v); if (x == null) return null; const n = Number(x.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const intg = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const truthy = (v) => { const x = (s(v) || "").toLowerCase(); return x === "true" || x === "1" || x === "yes" || x === "done"; };
function ts(v) {
  const x = s(v); if (!x) return null;
  let iso = x.length === 10 ? x + "T00:00:00Z" : x.replace(" ", "T");
  if (!/[Zz]$|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
  const d = new Date(iso); return isNaN(d) ? null : d.toISOString();
}
const dateOnly = (v) => { const x = s(v); return x ? x.slice(0, 10) : null; };
const first = (...vals) => { for (const v of vals) { const x = s(v); if (x) return x; } return null; };

function cellToStr(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v instanceof Date) return v.toISOString();
    if (v.hyperlink) return String(v.hyperlink);
    return JSON.stringify(v);
  }
  return v;
}

function rawJson(row) {
  const o = {};
  for (const [k, val] of Object.entries(row)) {
    if (AIRBYTE.has(k)) continue;
    const sv = s(val);
    if (sv != null) o[k] = sv;
  }
  return o;
}

// ---- readers ----------------------------------------------------------------
function readCsv(file) {
  const txt = fs.readFileSync(path.join(D, file), "utf8");
  const out = Papa.parse(txt, { header: true, skipEmptyLines: true });
  return out.data;
}

async function streamXlsx(file, onRow) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(path.join(D, file), { entries: "emit", sharedStrings: "cache" });
  let headers = null, n = 0;
  for await (const ws of wb) {
    for await (const row of ws) {
      const vals = row.values || [];
      if (!headers) {
        // Pipedrive exports can repeat a header (e.g. real "Pipeline" col + a
        // custom field also named "Pipeline"). Keep the FIRST under its name and
        // suffix later duplicates so lookups hit the real field and jsonb keeps all.
        const raw = vals.slice(1).map((h) => String(cellToStr(h) ?? ""));
        const seen = {};
        headers = raw.map((h) => { seen[h] = (seen[h] || 0) + 1; return seen[h] === 1 ? h : `${h} (${seen[h]})`; });
        continue;
      }
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cellToStr(vals[i + 1]); });
      n++;
      await onRow(obj);
    }
    break;
  }
  return n;
}

// ---- DB upsert --------------------------------------------------------------
let client;
async function flush(table, cols, rows, conflictCol) {
  if (DRY || rows.length === 0) return rows.length;
  const updatable = cols.filter((c) => c !== "id" && c !== conflictCol);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => {
      const ph = cols.map((c) => {
        let v = r[c];
        if (c === "pipedrive_data" && v != null) v = JSON.stringify(v);
        params.push(v === undefined ? null : v);
        return "$" + params.length;
      });
      return "(" + ph.join(",") + ")";
    });
    const setClause = updatable.length
      ? " DO UPDATE SET " + updatable.map((c) => `${c}=EXCLUDED.${c}`).join(",")
      : " DO NOTHING";
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (${conflictCol})${setClause}`;
    await client.query(sql, params);
  }
  return rows.length;
}

async function loadMap(sql) {
  if (DRY) return new Map();
  const { rows } = await client.query(sql);
  const m = new Map();
  for (const r of rows) m.set(String(r.k), r.v);
  return m;
}

// ---- main -------------------------------------------------------------------
const stats = {};
function bump(k, sub) { stats[k] = stats[k] || {}; stats[k][sub] = (stats[k][sub] || 0) + 1; }

(async () => {
  if (!URL) throw new Error("DATABASE_URL required");
  if (!DRY) { client = new Client({ connectionString: URL }); await client.connect(); }
  console.log(DRY ? "=== DRY RUN (no writes) ===" : "=== LIVE IMPORT ===");

  // 1) USERS ------------------------------------------------------------------
  const usersRaw = readCsv(F.users).filter((r) => s(r["ID"]));
  const userRows = usersRaw.map((r) => ({
    name: first(r["Name"], r["Email"], "User " + r["ID"]),
    email: (s(r["Email"]) || `pipedrive-${s(r["ID"])}@imported.local`).toLowerCase(),
    password_hash: "imported:" + crypto.randomBytes(24).toString("hex"),
    phone: s(r["Phone"]),
    is_admin: truthy(r["Is Admin"]),
    active_flag: false, // imported users activate via admin password reset
    default_currency: s(r["Default Currency"]) || "SAR",
    timezone_name: s(r["Timezone Name"]) || "Asia/Riyadh",
    last_login: ts(r["Last Login"]),
    pipedrive_id: intg(r["ID"]),
    pipedrive_data: rawJson(r),
  }));
  // conflict on email so we merge onto any existing (e.g. demo) account
  await flush("users", ["name", "email", "password_hash", "phone", "is_admin", "active_flag", "default_currency", "timezone_name", "last_login", "pipedrive_id", "pipedrive_data"], userRows, "email");
  console.log(`users: ${userRows.length}`);

  const userByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM users WHERE pipedrive_id IS NOT NULL");
  const userByName = await loadMap("SELECT lower(name) k, id v FROM users WHERE name IS NOT NULL");
  const userByEmail = await loadMap("SELECT lower(email) k, id v FROM users");
  // in-memory fallback for dry-run resolution coverage
  const pidUserSet = new Set(userRows.map((u) => String(u.pipedrive_id)));
  const nameUserSet = new Set(userRows.map((u) => (u.name || "").toLowerCase()));
  const emailUserSet = new Set(userRows.map((u) => (u.email || "").toLowerCase()));
  const resolveUser = (val) => {
    const x = s(val); if (!x) return null;
    const k = x.toLowerCase();
    if (DRY) return (x.includes("@") ? emailUserSet.has(k) : nameUserSet.has(k)) ? -1 : null;
    return (x.includes("@") ? userByEmail.get(k) : userByName.get(k)) ?? userByEmail.get(k) ?? userByName.get(k) ?? null;
  };

  // 2) PIPELINES --------------------------------------------------------------
  const pipesRaw = readCsv(F.pipelines).filter((r) => s(r["ID"]));
  const pipeNameToLocal = new Map();
  const pipeRows = pipesRaw.map((r) => {
    const pid = intg(r["ID"]);
    const local = PIPE_OFFSET + pid;
    pipeNameToLocal.set((s(r["Name"]) || "").toLowerCase(), local);
    return { id: local, name: s(r["Name"]) || "Pipeline " + pid, pipedrive_id: pid, pipedrive_data: rawJson(r) };
  });
  if (!DRY) {
    await client.query(`INSERT INTO pipelines (id,name) VALUES ($1,'Imported — Unknown') ON CONFLICT (id) DO NOTHING`, [FALLBACK_PIPELINE]);
    await client.query(`INSERT INTO stages (id,name,pipeline_id,probability) VALUES ($1,'Imported — Unknown',$2,0) ON CONFLICT (id) DO NOTHING`, [FALLBACK_STAGE, FALLBACK_PIPELINE]);
  }
  await flush("pipelines", ["id", "name", "pipedrive_id", "pipedrive_data"], pipeRows, "pipedrive_id");
  console.log(`pipelines: ${pipeRows.length}`);

  // 3) STAGES -----------------------------------------------------------------
  const stagesRaw = readCsv(F.stages).filter((r) => s(r["ID"]));
  const stageKeyToLocal = new Map(); // `${localPipelineId}::${stageNameLower}` -> localStageId
  const stageRows = stagesRaw.map((r) => {
    const pid = intg(r["ID"]);
    const local = PIPE_OFFSET + pid;
    const localPipe = PIPE_OFFSET + intg(r["Pipeline ID"]);
    stageKeyToLocal.set(`${localPipe}::${(s(r["Name"]) || "").toLowerCase()}`, local);
    return {
      id: local, name: s(r["Name"]) || "Stage " + pid, pipeline_id: localPipe,
      order_index: intg(r["Order Nr"]) ?? 0,
      probability: intg(r["Deal Probability"]) ?? 100,
      rotting_days: intg(r["Days To Rotten"]),
      pipedrive_id: pid, pipedrive_data: rawJson(r),
    };
  });
  await flush("stages", ["id", "name", "pipeline_id", "order_index", "probability", "rotting_days", "pipedrive_id", "pipedrive_data"], stageRows, "pipedrive_id");
  console.log(`stages: ${stageRows.length}`);
  // First (lowest-order) stage per pipeline — fallback for deals whose stage
  // name doesn't match, so they stay inside the right pipeline.
  const pipeFirstStage = new Map(), pipeMinOrder = new Map();
  for (const st of stageRows) {
    const cur = pipeMinOrder.get(st.pipeline_id);
    if (cur == null || st.order_index < cur) { pipeMinOrder.set(st.pipeline_id, st.order_index); pipeFirstStage.set(st.pipeline_id, st.id); }
  }

  // 4) ORGANIZATIONS ----------------------------------------------------------
  let buf = [], cnt = 0;
  const flushOrgs = async () => { cnt += await flush("organizations", ["name", "address", "owner_id", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.orgs, async (r) => {
    if (!s(r["ID"])) return;
    buf.push({
      name: first(r["Name"], "Organization " + r["ID"]),
      address: first(r["Full/combined address of Address"], r["Address"]),
      owner_id: DRY ? null : resolveUser(r["Owner"]),
      add_time: ts(r["Organization created"]) || new Date().toISOString(),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("orgs", "total"); if (resolveUser(r["Owner"]) != null) bump("orgs", "owner");
    if (buf.length >= CHUNK) await flushOrgs();
  });
  await flushOrgs();
  console.log(`organizations: ${cnt || stats.orgs?.total || 0}`);
  const orgByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM organizations WHERE pipedrive_id IS NOT NULL");
  const resolveOrg = (pdid) => { const x = intg(pdid); if (x == null) return null; return DRY ? null : (orgByPid.get(String(x)) ?? null); };

  // 5) PERSONS ----------------------------------------------------------------
  buf = []; cnt = 0;
  const flushPeople = async () => { cnt += await flush("persons", ["name", "phone", "email", "organization_id", "owner_id", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.people, async (r) => {
    if (!s(r["ID"])) return;
    buf.push({
      name: first(r["Name"], r["First name"], r["Email - Work"], "Person " + r["ID"]),
      phone: first(r["Phone - Mobile"], r["Phone - Work"], r["Phone - Home"], r["Phone - Other"]),
      email: first(r["Email - Work"], r["Email - Home"], r["Email - Other"]),
      organization_id: resolveOrg(r["Organization ID"]),
      owner_id: DRY ? null : resolveUser(r["Owner"]),
      add_time: ts(r["Person created"]) || new Date().toISOString(),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("people", "total");
    if (s(r["Organization ID"])) bump("people", "orgRef");
    if (buf.length >= CHUNK) await flushPeople();
  });
  await flushPeople();
  console.log(`persons: ${cnt || stats.people?.total || 0}`);
  const personByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM persons WHERE pipedrive_id IS NOT NULL");
  const resolvePerson = (pdid) => { const x = intg(pdid); if (x == null) return null; return DRY ? null : (personByPid.get(String(x)) ?? null); };

  // 6) DEALS ------------------------------------------------------------------
  const STATUS = { open: "open", won: "won", lost: "lost", deleted: "deleted" };
  buf = []; cnt = 0;
  const flushDeals = async () => {
    cnt += await flush("deals", ["title", "value", "currency", "status", "owner_id", "creator_user_id", "person_id", "organization_id", "pipeline_id", "stage_id", "visible_to", "lost_reason", "comments", "expected_close_date", "utm_source", "utm_medium", "utm_campaign", "utm_keyword", "ad_name", "gclid", "fbclid", "add_time", "stage_change_time", "won_time", "lost_time", "close_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id");
    buf = [];
  };
  await streamXlsx(F.deals, async (r) => {
    if (!s(r["ID"])) return;
    const pname = (s(r["Pipeline"]) || "").toLowerCase();
    const localPipe = pipeNameToLocal.get(pname) ?? FALLBACK_PIPELINE;
    const localStage = stageKeyToLocal.get(`${localPipe}::${(s(r["Stage"]) || "").toLowerCase()}`) ?? pipeFirstStage.get(localPipe) ?? FALLBACK_STAGE;
    bump("deals", "total");
    if (pipeNameToLocal.has(pname)) bump("deals", "pipeline");
    if (stageKeyToLocal.has(`${localPipe}::${(s(r["Stage"]) || "").toLowerCase()}`)) bump("deals", "stage");
    if (resolveUser(r["Owner"]) != null) bump("deals", "owner");
    if (s(r["Organization ID"])) bump("deals", "orgRef");
    if (s(r["Contact person ID"])) bump("deals", "personRef");
    buf.push({
      title: first(r["Title"], "Deal " + r["ID"]),
      value: num(r["Value"]) ?? 0,
      currency: s(r["Currency of Value"]) || "SAR",
      status: STATUS[(s(r["Status"]) || "open").toLowerCase()] || "open",
      owner_id: DRY ? null : resolveUser(r["Owner"]),
      creator_user_id: DRY ? null : resolveUser(r["Creator"]),
      person_id: resolvePerson(r["Contact person ID"]),
      organization_id: resolveOrg(r["Organization ID"]),
      pipeline_id: DRY ? FALLBACK_PIPELINE : localPipe,
      stage_id: DRY ? FALLBACK_STAGE : localStage,
      visible_to: s(r["Visible to"]),
      lost_reason: s(r["Lost reason"]),
      comments: s(r["Comments"]),
      expected_close_date: dateOnly(r["Expected close date"]),
      utm_source: s(r["UTM \\ Source"]),
      utm_medium: s(r["UTM \\ Medium"]),
      utm_campaign: s(r["UTM \\ Campaign"]),
      utm_keyword: s(r["UTM \\ Keyword"]),
      ad_name: s(r["ad_name"]),
      gclid: s(r["gclid"]),
      fbclid: s(r["fbclid"]),
      add_time: ts(r["Deal created"]) || new Date().toISOString(),
      stage_change_time: ts(r["Last stage change"]),
      won_time: ts(r["Won time"]),
      lost_time: ts(r["Lost time"]),
      close_time: ts(r["Deal closed on"]),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    if (buf.length >= CHUNK) await flushDeals();
  });
  await flushDeals();
  console.log(`deals: ${cnt || stats.deals?.total || 0}`);
  const dealByPid = await loadMap("SELECT pipedrive_id::text k, id v FROM deals WHERE pipedrive_id IS NOT NULL");
  const resolveDeal = (pdid) => { const x = intg(pdid); if (x == null) return null; return DRY ? null : (dealByPid.get(String(x)) ?? null); };

  // 7) LEADS ------------------------------------------------------------------
  buf = []; cnt = 0;
  const flushLeads = async () => { cnt += await flush("leads", ["title", "value", "currency", "owner_id", "person_id", "organization_id", "source_name", "labels", "expected_close_date", "archive_time", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.leads, async (r) => {
    if (!s(r["ID"])) return;
    buf.push({
      title: first(r["Title"], "Lead"),
      value: num(r["Value"]),
      currency: s(r["Currency"]),
      owner_id: DRY ? null : resolveUser(r["Owner"]),
      person_id: resolvePerson(r["Contact person ID"]),
      organization_id: resolveOrg(r["Organization ID"]),
      source_name: s(r["Source"]),
      labels: s(r["Labels"]),
      expected_close_date: dateOnly(r["Expected close date"]),
      archive_time: ts(r["Archive time"]),
      add_time: ts(r["Lead created"]) || new Date().toISOString(),
      pipedrive_id: s(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("leads", "total");
    if (buf.length >= CHUNK) await flushLeads();
  });
  await flushLeads();
  console.log(`leads: ${cnt || stats.leads?.total || 0}`);
  const leadByPid = await loadMap("SELECT pipedrive_id k, id v FROM leads WHERE pipedrive_id IS NOT NULL");
  const resolveLead = (pdid) => { const x = s(pdid); if (!x) return null; return DRY ? null : (leadByPid.get(x) ?? null); };

  // 8) ACTIVITIES -------------------------------------------------------------
  const ATYPE = new Set(["call", "meeting", "email", "task", "deadline"]);
  buf = []; cnt = 0;
  const flushActs = async () => { cnt += await flush("activities", ["subject", "type", "note", "done", "busy", "due_date", "due_time", "duration", "marked_as_done_time", "deal_id", "person_id", "org_id", "lead_id", "owner_id", "creator_user_id", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.activities, async (r) => {
    if (!s(r["ID"])) return;
    const t = (s(r["Type"]) || "task").toLowerCase();
    buf.push({
      subject: first(r["Subject"], r["Type"], "Activity " + r["ID"]),
      type: ATYPE.has(t) ? t : "task",
      note: first(r["Note"], r["Public description"]),
      done: truthy(r["Done"]),
      busy: (s(r["Free/busy"]) || "").toLowerCase() === "busy",
      due_date: dateOnly(r["Due date"]),
      due_time: s(r["Due time"]),
      duration: s(r["Duration"]),
      marked_as_done_time: ts(r["Marked as done time"]),
      deal_id: resolveDeal(r["Deal ID"]),
      person_id: resolvePerson(r["Contact person ID"]),
      org_id: resolveOrg(r["Organization ID"]),
      lead_id: resolveLead(r["Lead ID"]),
      owner_id: DRY ? null : resolveUser(r["Assigned to user"]),
      creator_user_id: DRY ? null : resolveUser(r["Creator"]),
      add_time: ts(r["Add time"]) || new Date().toISOString(),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("activities", "total");
    if (s(r["Deal ID"])) bump("activities", "dealRef");
    if (buf.length >= CHUNK) await flushActs();
  });
  await flushActs();
  console.log(`activities: ${cnt || stats.activities?.total || 0}`);

  // 9) NOTES ------------------------------------------------------------------
  buf = []; cnt = 0;
  const flushNotes = async () => { cnt += await flush("notes", ["content", "deal_id", "person_id", "org_id", "lead_id", "user_id", "pinned_to_deal_flag", "pinned_to_person_flag", "pinned_to_organization_flag", "pinned_to_lead_flag", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.notes, async (r) => {
    if (!s(r["ID"])) return;
    buf.push({
      content: s(r["Content"]) || "",
      deal_id: resolveDeal(r["Deal ID"]),
      person_id: resolvePerson(r["Contact person ID"]),
      org_id: resolveOrg(r["Organization ID"]),
      lead_id: resolveLead(r["Lead ID"]),
      user_id: DRY ? null : resolveUser(r["User"]),
      pinned_to_deal_flag: truthy(r["Note is pinned to deal"]),
      pinned_to_person_flag: truthy(r["Note is pinned to person"]),
      pinned_to_organization_flag: truthy(r["Note is pinned to organization"]),
      pinned_to_lead_flag: truthy(r["Note is pinned to lead"]),
      add_time: ts(r["Add time"]) || new Date().toISOString(),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("notes", "total");
    if (buf.length >= CHUNK) await flushNotes();
  });
  await flushNotes();
  console.log(`notes: ${cnt || stats.notes?.total || 0}`);

  // 10) FILES -----------------------------------------------------------------
  buf = []; cnt = 0;
  const flushFiles = async () => { cnt += await flush("files", ["file_name", "file_type", "download_url", "description", "deal_id", "person_id", "org_id", "lead_id", "user_id", "add_time", "pipedrive_id", "pipedrive_data"], buf, "pipedrive_id"); buf = []; };
  await streamXlsx(F.files, async (r) => {
    if (!s(r["ID"])) return;
    buf.push({
      file_name: s(r["File Name"]),
      file_type: s(r["File Type"]),
      download_url: s(r["Download URL"]),
      description: s(r["Description"]),
      deal_id: resolveDeal(r["Deal ID"]),
      person_id: resolvePerson(r["Person ID"]),
      org_id: resolveOrg(r["Organization ID"]),
      lead_id: resolveLead(r["Lead ID"]),
      user_id: DRY ? null : (userByPid.get(String(intg(r["User ID"]))) ?? null),
      add_time: ts(r["Add time"]),
      pipedrive_id: intg(r["ID"]),
      pipedrive_data: rawJson(r),
    });
    bump("files", "total");
    if (buf.length >= CHUNK) await flushFiles();
  });
  await flushFiles();
  console.log(`files: ${cnt || stats.files?.total || 0}`);

  console.log("\n=== resolution coverage ===");
  console.log(JSON.stringify(stats, null, 2));
  if (client) await client.end();
})().catch((e) => { console.error("IMPORT ERROR:", e.message); process.exit(1); });
