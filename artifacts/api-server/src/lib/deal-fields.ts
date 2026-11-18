import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  dealsTable,
  dealFieldsTable,
  dealFieldOptionsTable,
  stagesTable,
  pipelinesTable,
  type Deal,
  type DealField,
  type DealFieldOption,
  type DealFieldType,
  type DealFieldConfig,
  type ChangeValueSnapshot,
  runAsSystem,
} from "@workspace/db";
import {
  logDealChanges,
  logCustomFieldChange,
  type Tx,
  type ChangeContext,
} from "./change-events";
import { logger } from "./logger";

// The deal-field registry service: one accessor for every field regardless of
// where its value lives (a native column, an imported custom_fields
// jsonb, or a user-created custom_fields key). Reads via resolveDealFields,
// writes via setDealField (validated + audited), discovers existing keys via
// runDiscovery. See lib/db/src/schema/deal-fields.ts for the data model.

// ---------------------------------------------------------------------------
// Errors (routes map .status to the HTTP code).
// ---------------------------------------------------------------------------

export class DealFieldError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** A custom_fields object is plain decoded JSON keyed by source_key. */
function customFieldsOf(deal: Deal): Record<string, unknown> {
  const cf = (deal as { customFields?: unknown }).customFields;
  return cf && typeof cf === "object" ? (cf as Record<string, unknown>) : {};
}

const isEmpty = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

// ---------------------------------------------------------------------------
// Registry load.
// ---------------------------------------------------------------------------

export interface FieldRegistry {
  fields: DealField[];
  optionsByField: Map<number, DealFieldOption[]>;
}

/** Load active fields (ordered) + their active options. Pass
 *  `includeInactive` to also get inactive definitions (the deal detail shows
 *  inactive fields that hold data, read-only). */
export async function loadFieldRegistry(
  includeInactive = false,
): Promise<FieldRegistry> {
  const base = db.select().from(dealFieldsTable);
  const fields = await (includeInactive
    ? base
    : base.where(eq(dealFieldsTable.active, true))
  ).orderBy(asc(dealFieldsTable.orderIndex), asc(dealFieldsTable.id));

  const optionsByField = new Map<number, DealFieldOption[]>();
  if (fields.length) {
    const opts = await db
      .select()
      .from(dealFieldOptionsTable)
      .where(
        and(
          inArray(dealFieldOptionsTable.fieldId, fields.map((f) => f.id)),
          eq(dealFieldOptionsTable.active, true),
        ),
      )
      .orderBy(asc(dealFieldOptionsTable.orderIndex), asc(dealFieldOptionsTable.id));
    for (const o of opts) {
      const arr = optionsByField.get(o.fieldId) ?? [];
      arr.push(o);
      optionsByField.set(o.fieldId, arr);
    }
  }
  return { fields, optionsByField };
}

// ---------------------------------------------------------------------------
// Resolve (read) — one shape per field, value pulled from its storage.
// ---------------------------------------------------------------------------

export interface ResolvedField {
  key: string;
  label: string;
  fieldType: DealFieldType;
  storage: "custom" | "data" | "column";
  editable: boolean;
  active: boolean;
  group: string | null;
  /** Pipelines the field is limited to; null = every pipeline. */
  pipelineIds: number[] | null;
  order: number;
  value: unknown;
  options?: { value: string; label: string; color: string | null }[];
}

function readValue(deal: Deal, field: DealField): unknown {
  const src = field.sourceKey ?? field.key;
  if (field.storage === "column") {
    return (deal as Record<string, unknown>)[snakeToCamel(src)] ?? null;
  }
  const cf = customFieldsOf(deal);
  const base = cf[src] ?? null;
  // Composite types read their sub-keys alongside the base.
  if (field.fieldType === "monetary") {
    return base == null && cf[`${src}_currency`] == null
      ? null
      : { value: base, currency: cf[`${src}_currency`] ?? null };
  }
  if (field.fieldType === "daterange") {
    return base == null && cf[`${src}_until`] == null
      ? null
      : { from: base, to: cf[`${src}_until`] ?? null };
  }
  return base;
}

export function resolveDealFields(
  deal: Deal,
  registry: FieldRegistry,
): ResolvedField[] {
  return registry.fields.map((f) => ({
    key: f.key,
    label: f.label,
    fieldType: f.fieldType as DealFieldType,
    storage: f.storage,
    editable: f.editable,
    active: f.active,
    group: f.config?.group ?? null,
    pipelineIds: f.config?.pipelineIds?.length ? f.config.pipelineIds : null,
    order: f.orderIndex,
    value: readValue(deal, f),
    options: (registry.optionsByField.get(f.id) ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    })),
  }));
}

/** Empty for requirement purposes. The `value` column is NOT NULL DEFAULT 0,
 *  so a plain emptiness check would make requiring it a no-op — a 0 value
 *  counts as "not filled in". Scoped to column storage so a custom/data field
 *  that happens to own the key "value" keeps normal semantics (0 = filled). */
const isRequirementUnmet = (f: ResolvedField): boolean =>
  isEmpty(f.value) ||
  (f.key === "value" && f.storage === "column" && f.value === 0);

/**
 * Required fields for `stageId` that are currently empty on the deal. Used to
 * prompt the user after a stage move (the move itself is not blocked).
 */
export async function computeMissingRequiredFields(
  deal: Deal,
  stageId: number,
): Promise<ResolvedField[]> {
  const map = await computeMissingRequiredFieldsBulk([deal], stageId);
  return map.get(deal.id) ?? [];
}

/** The pipeline's won-required fields still empty on `deal`, as the deal
 *  will be after the write being checked. */
export async function computeMissingWonFields(
  deal: Deal,
  pipelineId: number,
): Promise<ResolvedField[]> {
  const [pipeline] = await db
    .select({ wonRequiredFields: pipelinesTable.wonRequiredFields })
    .from(pipelinesTable)
    .where(eq(pipelinesTable.id, pipelineId));
  const keys = new Set(pipeline?.wonRequiredFields ?? []);
  if (keys.size === 0) return [];
  const registry = await loadFieldRegistry();
  return resolveDealFields(deal, registry).filter(
    (f) => keys.has(f.key) && isRequirementUnmet(f),
  );
}

/** Requirements are cumulative down the funnel: entering a stage requires its
 *  own fields plus everything required by earlier (non-archived) stages of the
 *  same pipeline, ordered by (orderIndex, id) — the display order. */
async function effectiveRequiredFieldKeys(stageId: number): Promise<Set<string>> {
  const [stage] = await db
    .select({
      id: stagesTable.id,
      pipelineId: stagesTable.pipelineId,
      orderIndex: stagesTable.orderIndex,
    })
    .from(stagesTable)
    .where(eq(stagesTable.id, stageId));
  if (!stage) return new Set();
  const siblings = await db
    .select({
      id: stagesTable.id,
      orderIndex: stagesTable.orderIndex,
      archived: stagesTable.archived,
      requiredFields: stagesTable.requiredFields,
    })
    .from(stagesTable)
    .where(eq(stagesTable.pipelineId, stage.pipelineId));
  const required = new Set<string>();
  for (const s of siblings) {
    const atOrBefore =
      s.orderIndex < stage.orderIndex ||
      (s.orderIndex === stage.orderIndex && s.id <= stage.id);
    if (!atOrBefore) continue;
    // Archived stages are out of the funnel and stop contributing — but the
    // target stage's own list always applies.
    if (s.archived && s.id !== stage.id) continue;
    for (const k of s.requiredFields) required.add(k);
  }
  return required;
}

/**
 * Bulk variant: one stage + registry load for many deals. Returns only the
 * deals that still have empty required fields for `stageId` (absent = clear
 * to move). Used by /deals/bulk set_stage to enforce the same gate as the
 * single-deal PATCH.
 */
export async function computeMissingRequiredFieldsBulk(
  deals: Deal[],
  stageId: number,
): Promise<Map<number, ResolvedField[]>> {
  const out = new Map<number, ResolvedField[]>();
  if (deals.length === 0) return out;
  const required = await effectiveRequiredFieldKeys(stageId);
  if (required.size === 0) return out;
  const registry = await loadFieldRegistry();
  for (const deal of deals) {
    const missing = resolveDealFields(deal, registry).filter(
      (f) => required.has(f.key) && isRequirementUnmet(f),
    );
    if (missing.length) out.set(deal.id, missing);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validate + normalize a write.
// ---------------------------------------------------------------------------

interface Normalized {
  clear: boolean;
  primary?: unknown; // value written at source_key
  currency?: string; // monetary
  until?: string; // daterange
}

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new DealFieldError("Expected a number");
  return n;
}
function asDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) {
    throw new DealFieldError("Expected a YYYY-MM-DD date");
  }
  return v.slice(0, 10);
}

function normalize(
  field: DealField,
  options: DealFieldOption[],
  raw: unknown,
): Normalized {
  if (isEmpty(raw)) return { clear: true };
  const optionValues = new Set(options.map((o) => o.value));
  switch (field.fieldType as DealFieldType) {
    case "varchar":
    case "text":
      return { clear: false, primary: String(raw) };
    case "double":
      return { clear: false, primary: asNumber(raw) };
    case "boolean":
      return { clear: false, primary: Boolean(raw) };
    case "date":
      return { clear: false, primary: asDate(raw) };
    case "monetary": {
      const o = raw as { value?: unknown; currency?: unknown };
      const value = o && typeof o === "object" ? o.value : raw;
      if (isEmpty(value)) return { clear: true };
      const currency =
        o && typeof o === "object" && o.currency != null
          ? String(o.currency)
          : undefined;
      return { clear: false, primary: asNumber(value), currency };
    }
    case "daterange": {
      const o = (raw ?? {}) as { from?: unknown; to?: unknown };
      if (isEmpty(o.from) && isEmpty(o.to)) return { clear: true };
      return {
        clear: false,
        primary: isEmpty(o.from) ? null : asDate(o.from),
        until: isEmpty(o.to) ? undefined : asDate(o.to),
      };
    }
    case "enum": {
      const v = String(raw);
      if (!optionValues.has(v))
        throw new DealFieldError(`"${v}" is not a valid option`);
      return { clear: false, primary: v };
    }
    case "set": {
      // Store set values as actual sets: duplicate members are a no-op.
      const arr = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
      for (const v of arr) {
        if (!optionValues.has(v))
          throw new DealFieldError(`"${v}" is not a valid option`);
      }
      return { clear: false, primary: arr };
    }
    default:
      throw new DealFieldError(`Unsupported field type: ${field.fieldType}`);
  }
}

// ---------------------------------------------------------------------------
// Snapshot for the audit log.
// ---------------------------------------------------------------------------

function snapshotValue(
  field: DealField,
  value: unknown,
  options: DealFieldOption[] = [],
): ChangeValueSnapshot | null {
  if (isEmpty(value)) return null;
  if (field.fieldType === "monetary") {
    const o = value as { value?: unknown; currency?: unknown };
    const v = o && typeof o === "object" ? o.value : value;
    if (isEmpty(v)) return null;
    const cur = o && typeof o === "object" && o.currency ? ` ${o.currency}` : "";
    return { label: `${v}${cur}` };
  }
  if (field.fieldType === "daterange") {
    const o = value as { from?: unknown; to?: unknown };
    return { label: `${o.from ?? "…"} → ${o.to ?? "…"}` };
  }
  // enum/set store the option VALUE, which can differ from its display LABEL
  // for user-created fields — resolve to the label so the timeline is readable.
  if (field.fieldType === "enum" || field.fieldType === "set") {
    const labelOf = (v: unknown): string =>
      options.find((o) => o.value === v)?.label ?? String(v);
    if (Array.isArray(value)) {
      // Sort so re-saving the same members in a different order is a no-op
      // (matches valuesEqual's order-insensitive compare in change-events).
      return { label: value.map(labelOf).sort().join(", ") };
    }
    return { label: labelOf(value) };
  }
  if (Array.isArray(value)) return { label: value.map(String).join(", ") };
  return { label: String(value) };
}

function snapshotsEqual(
  a: ChangeValueSnapshot | null,
  b: ChangeValueSnapshot | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.label === b.label;
}

function resolvedAfterWrite(
  field: DealField,
  norm: Normalized,
  oldResolved: unknown,
): unknown {
  if (norm.clear) return null;
  if (field.fieldType === "monetary") {
    const oldCurrency =
      oldResolved && typeof oldResolved === "object"
        ? (oldResolved as { currency?: unknown }).currency
        : undefined;
    return {
      value: norm.primary,
      currency: norm.currency ?? oldCurrency ?? null,
    };
  }
  if (field.fieldType === "daterange") {
    return { from: norm.primary, to: norm.until ?? null };
  }
  return norm.primary;
}

// ---------------------------------------------------------------------------
// Set (write) — validated, stored at the right place, audited.
// ---------------------------------------------------------------------------

export async function setDealField(
  tx: Tx,
  deal: Deal, // current row, already locked FOR UPDATE by the caller
  field: DealField,
  options: DealFieldOption[],
  raw: unknown,
  ctx: ChangeContext,
): Promise<void> {
  if (!field.active) throw new DealFieldError("Field is not active", 400);
  if (!field.editable)
    throw new DealFieldError("Field is read-only / computed", 403);

  const src = field.sourceKey ?? field.key;
  const norm = normalize(field, options, raw);
  const oldResolved = readValue(deal, field);
  const newResolved = resolvedAfterWrite(field, norm, oldResolved);

  // ----- native column -----
  if (field.storage === "column") {
    const prop = snakeToCamel(src);
    // `value` is NOT NULL DEFAULT 0 — clearing it means back to 0 (which the
    // required-fields gate treats as unfilled), not NULL.
    const next = norm.clear ? (src === "value" ? 0 : null) : norm.primary;
    await tx
      .update(dealsTable)
      .set({ [prop]: next })
      .where(eq(dealsTable.id, deal.id));
    // logDealChanges only records fields in TRACKED_DEAL_FIELDS (e.g. labels);
    // others simply produce no event.
    await logDealChanges(tx, [{ before: deal, patch: { [prop]: next } }], ctx);
    return;
  }

  // ----- custom_fields jsonb (custom + data) -----
  if (norm.clear) {
    // Drop the base key and any composite sub-keys.
    let expr = sql`COALESCE(${dealsTable.customFields}, '{}'::jsonb)`;
    for (const k of [src, `${src}_currency`, `${src}_until`]) {
      expr = sql`${expr} - ${k}`;
    }
    await tx
      .update(dealsTable)
      .set({ customFields: expr })
      .where(eq(dealsTable.id, deal.id));
  } else {
    const patch: Record<string, unknown> = { [src]: norm.primary };
    if (field.fieldType === "monetary" && norm.currency != null)
      patch[`${src}_currency`] = norm.currency;
    if (field.fieldType === "daterange")
      patch[`${src}_until`] = norm.until ?? null;
    await tx
      .update(dealsTable)
      .set({
        customFields: sql`COALESCE(${dealsTable.customFields}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(dealsTable.id, deal.id));
  }

  const oldSnapshot = snapshotValue(field, oldResolved, options);
  const newSnapshot = snapshotValue(field, newResolved, options);
  if (snapshotsEqual(oldSnapshot, newSnapshot)) return;

  await logCustomFieldChange(
    tx,
    deal.id,
    `cf:${field.key}`,
    oldSnapshot,
    newSnapshot,
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Built-in column-backed definitions.
// ---------------------------------------------------------------------------

// Core deal columns registered as system, column-backed field definitions so
// the stage/won required-fields pickers can offer them. Their dedicated
// editors live on the deal header/details cards, so the custom-fields card
// hides them (CORE_COLUMN_FIELD_KEYS on the client).
const NATIVE_COLUMN_FIELDS: {
  key: string;
  label: string;
  sourceKey: string;
  fieldType: DealFieldType;
  active?: boolean;
}[] = [
  { key: "value", label: "Value", sourceKey: "value", fieldType: "double", active: true },
  { key: "expected_close_date", label: "Expected close date", sourceKey: "expected_close_date", fieldType: "date", active: true },
];

/** Idempotent: register the native columns as system, column-backed field
 *  definitions for the current tenant. Called when a tenant is created and,
 *  for every tenant, at server startup; existing definitions (same key or same
 *  storage+source) are left untouched. */
export async function ensureNativeColumnFields(): Promise<void> {
  await db
    .insert(dealFieldsTable)
    .values(
      NATIVE_COLUMN_FIELDS.map((f) => ({
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        storage: "column" as const,
        sourceKey: f.sourceKey,
        editable: true,
        active: f.active ?? false,
        system: true,
      })),
    )
    .onConflictDoNothing();

  // A pre-existing definition can own one of these keys (e.g. a discovered
  // custom_fields key that slugified to "value") — the insert above then
  // skips silently and any stage/won requirement on that key would gate on
  // the WRONG data. Surface the clash loudly so an admin resolves it.
  const rows = await db
    .select({
      key: dealFieldsTable.key,
      storage: dealFieldsTable.storage,
      sourceKey: dealFieldsTable.sourceKey,
    })
    .from(dealFieldsTable)
    .where(inArray(dealFieldsTable.key, NATIVE_COLUMN_FIELDS.map((f) => f.key)));
  for (const f of NATIVE_COLUMN_FIELDS) {
    const row = rows.find((r) => r.key === f.key);
    if (!row || row.storage !== "column" || row.sourceKey !== f.sourceKey) {
      logger.warn(
        { key: f.key, expected: { storage: "column", sourceKey: f.sourceKey }, found: row ?? null },
        "Native column field is shadowed by a conflicting deal_field definition — requirements on this key will not read the native column",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Discovery — decode existing custom_fields keys into reviewable definitions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin stats: how many deals actually have a value for each field.
// ---------------------------------------------------------------------------

export async function fieldUsageCounts(
  fields: DealField[],
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  for (const f of fields) {
    const src = f.sourceKey ?? f.key;
    try {
      // jsonb_exists() rather than the `?` operator: unambiguous through the
      // driver's parameter binding.
      const cond =
        f.storage === "column"
          ? sql`${sql.identifier(src)} is not null`
          : sql`jsonb_exists(custom_fields, ${src})`;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(dealsTable)
        .where(cond);
      out[f.id] = row?.c ?? 0;
    } catch {
      out[f.id] = 0; // unknown column / bad key → treat as unused
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// On-demand filterable indexing — one expression index per flagged field.
// "Only what's flagged": create when config.filterable is set, drop otherwise.
// The index name uses the field id (safe); the jsonb key is escaped as a SQL
// string literal. Native columns index separately and are skipped here.
// ---------------------------------------------------------------------------

const INDEXABLE_TYPES = new Set<DealFieldType>([
  "varchar",
  "text",
  "double",
  "monetary",
  "date",
  "enum",
]);

function fieldIndexName(field: DealField): string {
  return `deal_cf_${field.id}_idx`;
}

/** The CREATE INDEX DDL a field wants, or null if it should have no index. */
function desiredIndexDdl(field: DealField): string | null {
  if (!field.active || !field.config?.filterable) return null;
  if (field.storage === "column") return null;
  if (!INDEXABLE_TYPES.has(field.fieldType as DealFieldType)) return null;
  const src = (field.sourceKey ?? field.key).replace(/'/g, "''");
  const numeric = field.fieldType === "double" || field.fieldType === "monetary";
  const expr = numeric
    ? `((custom_fields ->> '${src}')::double precision)`
    : `((custom_fields ->> '${src}'))`;
  return `CREATE INDEX IF NOT EXISTS "${fieldIndexName(field)}" ON deals USING btree (${expr})`;
}

/** Make the deals expression indexes match the current filterable flags. */
export async function reconcileFieldIndexes(): Promise<{
  created: number;
  dropped: number;
}> {
  // The indexes live on the shared deals table, so the desired set is the
  // union over EVERY tenant's flagged fields. Reading only the current
  // tenant's fields would drop the indexes other tenants rely on.
  return runAsSystem(reconcileAllFieldIndexes);
}

async function reconcileAllFieldIndexes(): Promise<{
  created: number;
  dropped: number;
}> {
  const fields = await db.select().from(dealFieldsTable);
  const desired = new Map<string, string>();
  for (const f of fields) {
    const ddl = desiredIndexDdl(f);
    if (ddl) desired.set(fieldIndexName(f), ddl);
  }
  const existing = await db.execute<{ indexname: string }>(
    sql`select indexname from pg_indexes where tablename = 'deals' and indexname like 'deal\\_cf\\_%\\_idx'`,
  );
  const existingNames = existing.rows.map((r) => r.indexname);
  let created = 0;
  let dropped = 0;
  for (const [name, ddl] of desired) {
    if (!existingNames.includes(name)) {
      await db.execute(sql.raw(ddl));
      created++;
    }
  }
  for (const name of existingNames) {
    if (!desired.has(name)) {
      await db.execute(sql.raw(`DROP INDEX IF EXISTS "${name}"`));
      dropped++;
    }
  }
  return { created, dropped };
}

/** Strip a field's value (and composite sub-keys) from every deal. */
export async function purgeFieldValues(field: DealField): Promise<void> {
  if (field.storage === "column") return;
  const src = field.sourceKey ?? field.key;
  await db.update(dealsTable).set({
    customFields: sql`(COALESCE(custom_fields,'{}'::jsonb) - ${src} - ${`${src}_currency`} - ${`${src}_until`})`,
  });
}

const MONEY_KEY = /(acv|arr|mrr|value|amount|price|revenue|cost|fee)/i;

function slugify(key: string): string {
  return (
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field"
  );
}
function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferType(key: string, samples: unknown[]): DealFieldType {
  const present = samples.filter((s) => s != null);
  if (present.some((s) => Array.isArray(s))) return "set";
  if (present.every((s) => typeof s === "boolean") && present.length)
    return "boolean";
  if (present.every((s) => typeof s === "number") && present.length)
    return MONEY_KEY.test(key) ? "monetary" : "double";
  if (
    present.length &&
    present.every((s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s as string))
  )
    return "date";
  if (MONEY_KEY.test(key) && present.some((s) => typeof s === "number"))
    return "monetary";
  // All-string values with a small, repeating set → single-select (enum);
  // free text (every value distinct) stays varchar.
  const strings = present.filter((s): s is string => typeof s === "string");
  if (strings.length && strings.length === present.length) {
    const distinct = new Set(strings);
    if (distinct.size <= 15 && distinct.size < strings.length) return "enum";
  }
  return "varchar";
}

export interface DiscoveryResult {
  scanned: number;
  created: number;
  skipped: number;
}

/** Idempotent: scan distinct custom_fields keys, infer types, upsert pending
 *  (system, inactive) field definitions for an admin to review/activate. */
export async function runDiscovery(createdBy: number | null): Promise<DiscoveryResult> {
  const keyRows = await db.execute<{ k: string }>(
    sql`select distinct jsonb_object_keys(custom_fields) as k from ${dealsTable} where custom_fields is not null`,
  );
  const keys = keyRows.rows
    .map((r) => r.k)
    .filter((k) => k && !/_currency$|_until$/.test(k));

  let created = 0;
  let skipped = 0;
  for (const key of keys) {
    const sampleRows = await db.execute<{ v: unknown }>(
      sql`select custom_fields -> ${key} as v from ${dealsTable} where jsonb_exists(custom_fields, ${key}) limit 50`,
    );
    const samples = sampleRows.rows.map((r) => r.v);
    const fieldType = inferType(key, samples);

    const inserted = await db
      .insert(dealFieldsTable)
      .values({
        key: slugify(key),
        label: humanize(key),
        fieldType,
        storage: "data",
        sourceKey: key,
        editable: !MONEY_KEY.test(key) || fieldType !== "monetary", // computed money read-only by default
        active: false,
        system: true,
        createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: dealFieldsTable.id });

    if (!inserted.length) {
      skipped++;
      continue;
    }
    created++;

    // Seed enum/set options from the distinct sample labels.
    if (fieldType === "set" || fieldType === "enum") {
      const labels = new Set<string>();
      for (const s of samples) {
        if (Array.isArray(s)) s.forEach((x) => labels.add(String(x)));
        else if (s != null) labels.add(String(s));
      }
      if (labels.size) {
        await db
          .insert(dealFieldOptionsTable)
          .values(
            [...labels].map((v, i) => ({
              fieldId: inserted[0]!.id,
              value: v,
              label: v,
              orderIndex: i,
            })),
          )
          .onConflictDoNothing();
      }
    }
  }
  return { scanned: keys.length, created, skipped };
}
