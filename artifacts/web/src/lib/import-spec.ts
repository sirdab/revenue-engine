import Papa from "papaparse";
import type {
  DealImportRow,
  PersonImportRow,
  OrganizationImportRow,
} from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Single source of truth for the CSV importer.
//
// Each entity declares its fields once; everything else — the downloadable
// template, header auto-mapping, per-cell parsing, per-row validation and the
// final API payload — is derived from these declarations. Keeping it data-
// driven is what lets the wizard stay generic across all three entities.
// ---------------------------------------------------------------------------

export type EntityKey = "organizations" | "persons" | "deals";

// Must match MAX_ROWS in artifacts/api-server/src/routes/import.ts — the
// server hard-caps a single import request at this many rows, so the wizard
// submits larger files as sequential batches of at most this size.
export const IMPORT_BATCH_SIZE = 5000;

export type FieldType = "string" | "integer" | "number" | "date" | "stringArray";

/** A field that can be satisfied by a single bulk-selected value applied to
 *  every row, instead of (or in addition to) a CSV column. */
export type Defaultable =
  | "owner"
  | "organization"
  | "person"
  | "pipeline"
  | "stage"
  | "currency";

export interface FieldSpec {
  /** Canonical key — matches the API row property name. */
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  /** Example cell used in the downloadable template. */
  example: string;
  /** Header variants accepted during auto-mapping (besides key + label). */
  aliases?: string[];
  /** Short hint shown in the field list. */
  help?: string;
  defaultable?: Defaultable;
}

export interface EntitySpec {
  key: EntityKey;
  label: string;
  singular: string;
  description: string;
  fields: FieldSpec[];
}

/** Bulk-selected defaults applied to rows that omit the corresponding column. */
export interface ImportDefaults {
  ownerId?: number;
  organizationId?: number;
  personId?: number;
  pipelineId?: number;
  stageId?: number;
  currency?: string;
}

const DEFAULT_KEY: Record<Defaultable, keyof ImportDefaults> = {
  owner: "ownerId",
  organization: "organizationId",
  person: "personId",
  pipeline: "pipelineId",
  stage: "stageId",
  currency: "currency",
};

// ---- Field declarations ----------------------------------------------------

const ID_HELP = "Numeric ID of an existing record, or leave blank and bulk-select a default below.";

export const ENTITY_SPECS: Record<EntityKey, EntitySpec> = {
  organizations: {
    key: "organizations",
    label: "Organizations",
    singular: "organization",
    description: "Companies / accounts.",
    fields: [
      {
        key: "name",
        label: "Name",
        required: true,
        type: "string",
        example: "Acme Corp",
        aliases: ["organization", "organisation", "company", "org", "company name"],
      },
      {
        key: "address",
        label: "Address",
        required: false,
        type: "string",
        example: "221B Baker Street, London",
        aliases: ["location", "full/combined address of address"],
      },
      {
        key: "ownerId",
        label: "Owner ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["owner", "owner id"],
        defaultable: "owner",
        help: ID_HELP,
      },
    ],
  },
  persons: {
    key: "persons",
    label: "People",
    singular: "person",
    description: "Contacts.",
    fields: [
      {
        key: "name",
        label: "Name",
        required: true,
        type: "string",
        example: "Sara Ahmed",
        aliases: ["full name", "contact", "contact name", "person"],
      },
      {
        key: "email",
        label: "Email",
        required: false,
        type: "string",
        example: "sara@acme.com",
        aliases: ["e-mail", "email address", "email - work", "email - home", "email - other"],
      },
      {
        key: "phone",
        label: "Phone",
        required: false,
        type: "string",
        example: "+15550100",
        aliases: [
          "mobile",
          "telephone",
          "phone number",
          "phone - mobile",
          "phone - work",
          "phone - home",
          "phone - other",
        ],
      },
      {
        key: "jobTitle",
        label: "Job title",
        required: false,
        type: "string",
        example: "Operations Manager",
        aliases: ["title", "position", "role", "job", "designation"],
      },
      {
        key: "organizationId",
        label: "Organization ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["organization", "org id", "orgid", "company id"],
        defaultable: "organization",
        help: ID_HELP,
      },
      {
        key: "ownerId",
        label: "Owner ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["owner", "owner id"],
        defaultable: "owner",
        help: ID_HELP,
      },
    ],
  },
  deals: {
    key: "deals",
    label: "Deals",
    singular: "deal",
    description: "Opportunities in a pipeline.",
    fields: [
      {
        key: "title",
        label: "Title",
        required: true,
        type: "string",
        example: "Acme – Annual plan",
        aliases: ["deal", "deal title", "name", "deal name"],
      },
      {
        key: "value",
        label: "Value",
        required: false,
        type: "number",
        example: "120000",
        aliases: ["amount", "deal value"],
      },
      {
        key: "currency",
        label: "Currency",
        required: false,
        type: "string",
        example: "USD",
        aliases: ["currency of value"],
        defaultable: "currency",
      },
      {
        key: "pipelineId",
        label: "Pipeline ID",
        required: true,
        type: "integer",
        example: "",
        aliases: ["pipeline", "pipeline id"],
        defaultable: "pipeline",
        help: "Required. Map a column of pipeline IDs, or bulk-select a pipeline below.",
      },
      {
        key: "stageId",
        label: "Stage ID",
        required: true,
        type: "integer",
        example: "",
        aliases: ["stage", "stage id"],
        defaultable: "stage",
        help: "Required. Must belong to the chosen pipeline.",
      },
      {
        key: "ownerId",
        label: "Owner ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["owner", "owner id"],
        defaultable: "owner",
        help: ID_HELP,
      },
      {
        key: "personId",
        label: "Person ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["person", "contact id"],
        defaultable: "person",
        help: ID_HELP,
      },
      // Inline contact creation: fill Person phone (and optionally name/email)
      // to create a contact in the same import and link it — no need to import
      // People first. A matching phone reuses the existing contact. Ignored
      // when Person ID is set.
      {
        key: "personPhone",
        label: "Person phone",
        required: false,
        type: "string",
        example: "+15550100",
        aliases: ["phone", "mobile", "telephone", "phone number", "contact phone"],
        help: "Creates (or reuses by phone) a contact and links it. Leave blank to use Person ID instead.",
      },
      {
        key: "personName",
        label: "Person name",
        required: false,
        type: "string",
        example: "Sara Ahmed",
        aliases: ["contact name", "person name", "poc", "poc name", "contact person"],
        help: "Optional name for the contact created from Person phone.",
      },
      {
        key: "personEmail",
        label: "Person email",
        required: false,
        type: "string",
        example: "sara@acme.com",
        aliases: ["email", "contact email", "person email", "e-mail"],
        help: "Optional email for the contact created from Person phone.",
      },
      {
        key: "organizationId",
        label: "Organization ID",
        required: false,
        type: "integer",
        example: "",
        aliases: ["organization", "org id", "orgid"],
        defaultable: "organization",
        help: ID_HELP,
      },
      {
        key: "expectedCloseDate",
        label: "Expected close date",
        required: false,
        type: "date",
        example: "2026-08-31",
        aliases: ["close date", "expected close"],
        help: "Format YYYY-MM-DD.",
      },
      {
        key: "labels",
        label: "Labels",
        required: false,
        type: "stringArray",
        example: "enterprise;priority",
        aliases: ["label"],
        help: "Separate multiple labels with ; or ,",
      },
    ],
  },
};

// ---- Header auto-mapping ---------------------------------------------------

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---- Pipedrive exports -----------------------------------------------------
//
// Pipedrive's spreadsheet exports name their columns plainly ("Title",
// "Currency of Value", "Email - Work"), or with the entity in front from some
// list views ("Deal - Title"). The aliases above cover the plain names. Its
// owner, organization, person, pipeline and stage columns hold Pipedrive's
// names and ids, never this workspace's IDs, so a Pipedrive file must not
// auto-map onto an ID field (a Pipedrive "Organization ID" of 42 would link
// to whatever local organization has id 42): those come from the defaults.

/** Columns only Pipedrive's exports carry. */
const PIPEDRIVE_MARKERS = new Set(
  [
    "contact person id",
    "currency of value",
    "organization created",
    "person created",
    "deal created",
    "full/combined address of address",
    "last stage change",
    "deal closed on",
    // Pipedrive's labelled contact columns ("Email - Work", "Phone - Mobile").
    "email - work",
    "email - home",
    "email - other",
    "phone - work",
    "phone - mobile",
    "phone - home",
    "phone - other",
  ].map(norm),
);

const PIPEDRIVE_PREFIX: Record<EntityKey, string> = {
  organizations: "organization",
  persons: "person",
  deals: "deal",
};

const ANY_PIPEDRIVE_PREFIX = /^(deal|person|organization|lead)\s+-\s+/i;

/** True when the headers look like a Pipedrive export. */
export function isPipedriveExport(headers: string[]): boolean {
  if (headers.some((h) => PIPEDRIVE_MARKERS.has(norm(h)))) return true;
  return headers.filter((h) => ANY_PIPEDRIVE_PREFIX.test(h)).length >= 2;
}

/** Best-effort map of fieldKey -> CSV header, by key/label/alias match. */
export function autoMapHeaders(
  entity: EntityKey,
  headers: string[],
): Record<string, string> {
  const pipedrive = isPipedriveExport(headers);
  // "Deal - Title" in a deals file is just "Title". Other entities' prefixes
  // stay: "Person - Name" in a deals file is the deal's person name.
  const ownPrefix = new RegExp(`^${PIPEDRIVE_PREFIX[entity]}\\s+-\\s+`, "i");
  const headerKey = (h: string) => norm(pipedrive ? h.replace(ownPrefix, "") : h);
  const map: Record<string, string> = {};
  for (const field of ENTITY_SPECS[entity].fields) {
    if (pipedrive && field.defaultable && field.type === "integer") continue;
    const candidates = new Set(
      [field.key, field.label, ...(field.aliases ?? [])].map(norm),
    );
    const match = headers.find((h) => candidates.has(headerKey(h)));
    if (match) map[field.key] = match;
  }
  return map;
}

// ---- Template download -----------------------------------------------------

/** A CSV (header row + one example row) the user can fill in and re-upload. */
export function buildTemplateCsv(entity: EntityKey): string {
  const fields = ENTITY_SPECS[entity].fields;
  const header = fields.map((f) => f.key);
  const example = fields.map((f) => f.example);
  return Papa.unparse([header, example]);
}

export function downloadTemplate(entity: EntityKey): void {
  const csv = buildTemplateCsv(entity);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entity}-import-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Per-cell parsing ------------------------------------------------------

function parseCell(
  type: FieldType,
  raw: string,
): { value?: unknown; error?: string } {
  const s = raw.trim();
  switch (type) {
    case "string":
      return { value: s };
    case "integer": {
      const n = Number(s);
      if (!Number.isInteger(n)) return { error: "must be a whole number" };
      return { value: n };
    }
    case "number": {
      const n = Number(s);
      if (!Number.isFinite(n)) return { error: "must be a number" };
      return { value: n };
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: "must be YYYY-MM-DD" };
      return { value: s };
    case "stringArray":
      return { value: s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) };
  }
}

// ---- Row validation --------------------------------------------------------

export interface CellError {
  field: string;
  label: string;
  message: string;
}

export interface ValidatedRow {
  /** 0-based index into the parsed CSV rows. */
  index: number;
  data: Record<string, unknown>;
  errors: CellError[];
}

/** Required fields with neither a mapped column nor a bulk-selected default —
 *  every row would fail on them, so the wizard prompts the user to bulk-select
 *  before validating (e.g. pipeline & stage for deals). */
export function unsatisfiedRequiredFields(
  entity: EntityKey,
  mapping: Record<string, string>,
  defaults: ImportDefaults,
): FieldSpec[] {
  return ENTITY_SPECS[entity].fields.filter((f) => {
    if (!f.required) return false;
    if (mapping[f.key]) return false;
    if (f.defaultable && defaults[DEFAULT_KEY[f.defaultable]] != null) return false;
    return true;
  });
}

/** Validate every parsed CSV row against the spec + mapping + defaults. */
export function validateRows(
  entity: EntityKey,
  csvRows: Record<string, string>[],
  mapping: Record<string, string>,
  defaults: ImportDefaults,
): ValidatedRow[] {
  const fields = ENTITY_SPECS[entity].fields;
  return csvRows.map((csvRow, index) => {
    const data: Record<string, unknown> = {};
    const errors: CellError[] = [];

    for (const field of fields) {
      const header = mapping[field.key];
      const raw = header ? (csvRow[header] ?? "") : "";

      if (raw.trim() !== "") {
        const parsed = parseCell(field.type, raw);
        if (parsed.error) {
          errors.push({
            field: field.key,
            label: field.label,
            message: `${field.label} ${parsed.error}.`,
          });
          continue;
        }
        data[field.key] = parsed.value;
        continue;
      }

      // Empty cell — fall back to a bulk-selected default if this field has one.
      if (field.defaultable) {
        const dflt = defaults[DEFAULT_KEY[field.defaultable]];
        if (dflt != null) {
          data[field.key] = dflt;
          continue;
        }
      }

      if (field.required) {
        errors.push({
          field: field.key,
          label: field.label,
          message: `${field.label} is required.`,
        });
      }
    }

    return { index, data, errors };
  });
}

// ---- Typed payload builders ------------------------------------------------
// Validated rows only contain known keys with already-coerced types, so the
// cast to the generated row type is sound.

export function toOrganizationRows(rows: ValidatedRow[]): OrganizationImportRow[] {
  return rows.map((r) => r.data as unknown as OrganizationImportRow);
}
export function toPersonRows(rows: ValidatedRow[]): PersonImportRow[] {
  return rows.map((r) => r.data as unknown as PersonImportRow);
}
export function toDealRows(rows: ValidatedRow[]): DealImportRow[] {
  return rows.map((r) => r.data as unknown as DealImportRow);
}
