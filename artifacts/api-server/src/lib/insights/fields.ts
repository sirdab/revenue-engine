import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  dealFieldsTable,
  dealFieldOptionsTable,
  type DealField,
} from "@workspace/db";
import { CUSTOM_FIELD_PREFIX } from "@workspace/deals-filter";
import type { InsightsScope } from "@workspace/insights-spec";

// ---------------------------------------------------------------------------
// Per-scope field allow-lists — THE self-serve surface (ticket P1).
//
// Every key listed here (plus, for deals, the active custom fields from the
// deal_field registry) is buildable and filterable; anything else is rejected
// by the compilers. Keys are our own vocabulary, resolved to columns/JSONB
// paths server-side — client input never names a column directly.
// ---------------------------------------------------------------------------

export interface InsightsFieldDef {
  key: string;
  label: string;
  /** varchar|text|double|monetary|date|boolean|enum|set|user|stage|pipeline|status */
  type: string;
  kind: "column" | "custom";
  filterable: boolean;
  groupable: boolean;
  measurable: boolean;
  options?: { value: string; label: string }[];
  /** For kind=custom: the JSONB key inside deals.custom_fields. */
  customKey?: string;
}

const dim = (
  key: string,
  label: string,
  type: string,
  measurable = false,
): InsightsFieldDef => ({
  key,
  label,
  type,
  kind: "column",
  filterable: true,
  groupable: true,
  measurable,
});

export const DEALS_NATIVE_FIELDS: InsightsFieldDef[] = [
  // Organization name lives on a joined table: filterable (the compiler adds
  // the join) but not groupable/measurable yet.
  {
    key: "organization",
    label: "Organization",
    type: "text",
    kind: "column",
    filterable: true,
    groupable: false,
    measurable: false,
  },
  dim("owner", "Owner", "user"),
  dim("pipeline", "Pipeline", "pipeline"),
  dim("stage", "Stage", "stage"),
  dim("status", "Status", "status"),
  dim("lostReason", "Lost reason", "text"),
  dim("value", "Value", "monetary", true),
  dim("createdAt", "Deal created", "date"),
  dim("wonAt", "Won time", "date"),
  dim("lostAt", "Lost time", "date"),
  dim("closedAt", "Close time", "date"),
  dim("utmSource", "UTM source", "text"),
  dim("utmMedium", "UTM medium", "text"),
  dim("utmCampaign", "UTM campaign", "text"),
  dim("utmKeyword", "UTM keyword", "text"),
  dim("adName", "Ad name", "text"),
  dim("title", "Title", "text"),
];

// Mirrors the activity_type pg enum; hardcoded like the enum itself.
export const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "task", label: "Task" },
  { value: "deadline", label: "Deadline" },
  { value: "whatsapp", label: "WhatsApp" },
];

export const ACTIVITIES_NATIVE_FIELDS: InsightsFieldDef[] = [
  // Organization name lives on a joined table (activities.org_id): filterable
  // — the compiler adds the join — but not groupable/measurable yet.
  {
    key: "organization",
    label: "Organization",
    type: "text",
    kind: "column",
    filterable: true,
    groupable: false,
    measurable: false,
  },
  dim("owner", "Owner", "user"),
  {
    key: "type",
    label: "Type",
    type: "enum",
    kind: "column",
    filterable: true,
    groupable: true,
    measurable: false,
    options: ACTIVITY_TYPE_OPTIONS,
  },
  dim("done", "Done", "boolean"),
  dim("dueDate", "Due date", "date"),
  dim("doneAt", "Marked done", "date"),
  dim("createdAt", "Created", "date"),
  dim("subject", "Subject", "text"),
  // Long free text: searchable, but grouping by it would be noise.
  {
    key: "note",
    label: "Note",
    type: "text",
    kind: "column",
    filterable: true,
    groupable: false,
    measurable: false,
  },
];

export const ORGANIZATIONS_NATIVE_FIELDS: InsightsFieldDef[] = [
  dim("owner", "Owner", "user"),
  dim("name", "Name", "text"),
  dim("createdAt", "Created", "date"),
];

const NATIVE_BY_SCOPE: Record<InsightsScope, InsightsFieldDef[]> = {
  deals: DEALS_NATIVE_FIELDS,
  activities: ACTIVITIES_NATIVE_FIELDS,
  organizations: ORGANIZATIONS_NATIVE_FIELDS,
};

/** Registry field types that the compiler can cast and filter on. */
const SUPPORTED_CUSTOM_TYPES = new Set([
  "varchar",
  "text",
  "double",
  "monetary",
  "date",
  "boolean",
  "enum",
  "set",
]);

function registrySourceKey(field: DealField): string | null {
  // storage=custom stores under the hashed `key`; storage=data under the
  // Pipedrive-decoded `sourceKey`. storage=column fields are exposed through
  // the native list above instead, so they are skipped here.
  if (field.storage === "custom") return field.key;
  if (field.storage === "data") return field.sourceKey;
  return null;
}

export interface DealsFieldCatalog {
  fields: InsightsFieldDef[];
  /** cf:<key> → def, for compiler lookups. */
  customByRef: Map<string, InsightsFieldDef>;
}

// The registry changes rarely (admin action) but the catalog is needed on
// every /insights/query, so cache it briefly. 30s staleness after an admin
// edit is acceptable; the cache also keeps a board of ~15 widgets from
// issuing 30 registry queries per load.
const CATALOG_TTL_MS = 30_000;
let catalogCache: { value: DealsFieldCatalog; expires: number } | null = null;

export function invalidateDealsFieldCatalog(): void {
  catalogCache = null;
}

/** Deals field catalog: native allow-list + active registry custom fields. */
export async function loadDealsFieldCatalog(): Promise<DealsFieldCatalog> {
  if (catalogCache && catalogCache.expires > Date.now()) {
    return catalogCache.value;
  }
  const rows = await db
    .select()
    .from(dealFieldsTable)
    .where(eq(dealFieldsTable.active, true))
    .orderBy(asc(dealFieldsTable.orderIndex));

  const custom: InsightsFieldDef[] = [];
  const customByRef = new Map<string, InsightsFieldDef>();
  const optionParents = rows.filter(
    (r) => r.fieldType === "enum" || r.fieldType === "set",
  );
  const optionsByField = new Map<number, { value: string; label: string }[]>();
  if (optionParents.length > 0) {
    const opts = await db
      .select()
      .from(dealFieldOptionsTable)
      .where(
        and(
          eq(dealFieldOptionsTable.active, true),
          inArray(
            dealFieldOptionsTable.fieldId,
            optionParents.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(dealFieldOptionsTable.orderIndex));
    for (const o of opts) {
      const list = optionsByField.get(o.fieldId) ?? [];
      list.push({ value: o.value, label: o.label });
      optionsByField.set(o.fieldId, list);
    }
  }

  for (const row of rows) {
    const sourceKey = registrySourceKey(row);
    if (!sourceKey || !SUPPORTED_CUSTOM_TYPES.has(row.fieldType)) continue;
    const def: InsightsFieldDef = {
      key: `${CUSTOM_FIELD_PREFIX}${sourceKey}`,
      label: row.label,
      type: row.fieldType,
      kind: "custom",
      filterable: true,
      groupable: true,
      measurable: row.fieldType === "double" || row.fieldType === "monetary",
      customKey: sourceKey,
      options: optionsByField.get(row.id),
    };
    custom.push(def);
    customByRef.set(def.key, def);
  }

  const catalog: DealsFieldCatalog = {
    fields: [...DEALS_NATIVE_FIELDS, ...custom],
    customByRef,
  };
  catalogCache = { value: catalog, expires: Date.now() + CATALOG_TTL_MS };
  return catalog;
}

export async function listInsightsFields(
  scope: InsightsScope,
): Promise<InsightsFieldDef[]> {
  if (scope === "deals") {
    return (await loadDealsFieldCatalog()).fields;
  }
  return NATIVE_BY_SCOPE[scope];
}
