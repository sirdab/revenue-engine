import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Admin registry (Settings › Custom Fields).
// ---------------------------------------------------------------------------

export interface DealFieldConfig {
  required?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  detailVisible?: boolean;
  group?: string;
  description?: string;
  /** Pipelines the field belongs to. Absent or empty = every pipeline. */
  pipelineIds?: number[];
}

/** Whether a field belongs on a deal in `pipelineId`. Mirrors the server's
 *  `DealFieldConfig.pipelineIds` rule: no list means every pipeline. */
export function fieldInPipeline(
  pipelineIds: number[] | null | undefined,
  pipelineId: number | null | undefined,
): boolean {
  if (!pipelineIds || pipelineIds.length === 0) return true;
  return pipelineId != null && pipelineIds.includes(pipelineId);
}

export interface DealFieldRow {
  id: number;
  key: string;
  label: string;
  fieldType: string;
  storage: DealFieldStorage;
  sourceKey: string | null;
  editable: boolean;
  active: boolean;
  system: boolean;
  config: DealFieldConfig;
  orderIndex: number;
  usage: number | null;
  addTime: string;
  updateTime: string;
}

export interface DealFieldOptionRow {
  id: number;
  fieldId: number;
  value: string;
  label: string;
  color: string | null;
  orderIndex: number;
  active: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const e = (await res.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function useDealFieldRegistry() {
  return useQuery({
    queryKey: ["deal-field-registry"],
    queryFn: async () => {
      const res = await fetch("/api/deal-fields?usage=1", {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      return json<{ fields: DealFieldRow[]; options: DealFieldOptionRow[] }>(res);
    },
    staleTime: 30_000,
  });
}

export interface CreateFieldBody {
  label: string;
  fieldType: string;
  editable?: boolean;
  active?: boolean;
  config?: DealFieldConfig;
  options?: { value: string; label?: string; color?: string | null }[];
}

const writeHeaders = {
  "content-type": "application/json",
  accept: "application/json",
};

export async function createDealField(body: CreateFieldBody): Promise<DealFieldRow> {
  const res = await fetch("/api/deal-fields", {
    method: "POST",
    headers: writeHeaders,
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  return json<DealFieldRow>(res);
}

export interface UpdateFieldBody {
  label?: string;
  editable?: boolean;
  active?: boolean;
  orderIndex?: number;
  config?: DealFieldConfig;
  options?: { value: string; label?: string; color?: string | null }[];
}

export async function updateDealField(
  id: number,
  body: UpdateFieldBody,
): Promise<DealFieldRow> {
  const res = await fetch(`/api/deal-fields/${id}`, {
    method: "PATCH",
    headers: writeHeaders,
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  return json<DealFieldRow>(res);
}

export async function deleteDealField(id: number, purge = false): Promise<void> {
  const res = await fetch(`/api/deal-fields/${id}${purge ? "?purge=true" : ""}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  await json<unknown>(res);
}

export async function reorderDealFields(ids: number[]): Promise<void> {
  const res = await fetch("/api/deal-fields/reorder", {
    method: "POST",
    headers: writeHeaders,
    credentials: "same-origin",
    body: JSON.stringify({ ids }),
  });
  await json<unknown>(res);
}

export async function discoverDealFields(): Promise<{
  scanned: number;
  created: number;
  skipped: number;
}> {
  const res = await fetch("/api/deal-fields/discover", {
    method: "POST",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  return json(res);
}

// Hand-written client for the deal custom-fields API (the openapi codegen is
// paused).

export interface DealFieldOption {
  value: string;
  label: string;
  color: string | null;
}

export type DealFieldStorage = "custom" | "data" | "column";

export interface ResolvedDealField {
  key: string;
  label: string;
  fieldType: string;
  storage: DealFieldStorage;
  editable: boolean;
  /** Inactive fields are returned too so filled data can be shown read-only. */
  active: boolean;
  group: string | null;
  /** Pipelines the field is limited to; null = every pipeline. */
  pipelineIds: number[] | null;
  order: number;
  value: unknown;
  options?: DealFieldOption[];
}

export function dealFieldsQueryKey(dealId: number | string): [string, string] {
  return ["deal-fields", String(dealId)];
}

// ---------------------------------------------------------------------------
// Blocked stage moves. PATCH /deals/:id answers 409 + the missing required
// fields when a deal tries to enter a stage whose required fields are empty;
// callers open the required-fields modal and retry after the user fills them.
// ---------------------------------------------------------------------------

export interface RequiredFieldsBlock {
  keys: string[];
  stageName: string | null;
}

export function requiredFieldsBlock(err: unknown): RequiredFieldsBlock | null {
  const e = err as {
    status?: number;
    data?: {
      code?: string;
      missingRequiredFields?: { key?: string }[];
      stageName?: string;
    };
  } | null;
  if (!e || e.status !== 409 || e.data?.code !== "REQUIRED_FIELDS_MISSING") {
    return null;
  }
  return {
    keys: (e.data.missingRequiredFields ?? [])
      .map((m) => String(m.key ?? ""))
      .filter(Boolean),
    stageName: e.data.stageName ?? null,
  };
}

async function fetchDealFields(dealId: string): Promise<ResolvedDealField[]> {
  const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/fields`, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Failed to load deal fields (${res.status})`);
  const data = (await res.json()) as { fields: ResolvedDealField[] };
  return data.fields;
}

export function useDealFields(dealId: number | string | null) {
  return useQuery({
    queryKey: dealFieldsQueryKey(dealId ?? ""),
    queryFn: () => fetchDealFields(String(dealId)),
    enabled: dealId != null && dealId !== "",
    staleTime: 60_000,
  });
}

// Write one field value; returns the freshly resolved field list (so the caller
// can update the cache without a refetch).
export async function setDealFieldValue(
  dealId: number | string,
  key: string,
  value: unknown,
): Promise<ResolvedDealField[]> {
  const res = await fetch(
    `/api/deals/${encodeURIComponent(String(dealId))}/fields/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ value }),
    },
  );
  if (!res.ok) {
    let msg = `Failed to save (${res.status})`;
    try {
      const e = (await res.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { fields: ResolvedDealField[] };
  return data.fields;
}
