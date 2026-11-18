import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  getListPipelinesQueryKey,
  getListStagesQueryKey,
  getGetBoardQueryKey,
  getGetPipelineFunnelQueryKey,
} from "@workspace/api-client-react";

// Hand-written client for the admin pipeline/stage endpoints (codegen paused).
// Mirrors deal-fields-api.ts.

export interface AdminPipelineRow {
  id: number;
  name: string;
  isDefault: boolean;
  archived: boolean;
  orderIndex: number;
  /** Deal field keys that must be filled before a deal in this pipeline can
   *  be marked as won. */
  wonRequiredFields: string[];
  /** Only an admin may change a deal's owner in this pipeline. */
  adminOnlyReassign: boolean;
  activeDealCount: number;
}

export interface AdminStageRow {
  id: number;
  name: string;
  pipelineId: number;
  orderIndex: number;
  probability: number;
  rottingDays: number | null;
  archived: boolean;
  requiredFields: string[];
  activeDealCount: number;
}

// Carries the server's error body so callers can react (e.g. 409 needsReassign).
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const writeHeaders = { "content-type": "application/json", accept: "application/json" };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    throw new ApiError(
      (body.error as string) ?? `Request failed (${res.status})`,
      res.status,
      body,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ----- queries -----

export function useAdminPipelines() {
  return useQuery({
    queryKey: ["admin-pipelines"],
    queryFn: () => req<AdminPipelineRow[]>("/api/admin/pipelines"),
    staleTime: 15_000,
  });
}

export function useAdminStages(pipelineId: number | null) {
  return useQuery({
    queryKey: ["admin-stages", pipelineId],
    queryFn: () =>
      req<AdminStageRow[]>(`/api/admin/stages?pipelineId=${pipelineId}`),
    enabled: pipelineId != null,
    staleTime: 15_000,
  });
}

// ----- mutations -----

export const createPipeline = (name: string) =>
  req<AdminPipelineRow>("/api/admin/pipelines", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({ name }),
  });

export const updatePipeline = (
  id: number,
  patch: {
    name?: string;
    archived?: boolean;
    wonRequiredFields?: string[];
    adminOnlyReassign?: boolean;
  },
) =>
  req<AdminPipelineRow>(`/api/admin/pipelines/${id}`, {
    method: "PATCH",
    headers: writeHeaders,
    body: JSON.stringify(patch),
  });

export const setDefaultPipeline = (id: number) =>
  req(`/api/admin/pipelines/${id}/set-default`, {
    method: "POST",
    headers: writeHeaders,
  });

export const reorderPipelines = (ids: number[]) =>
  req("/api/admin/pipelines/reorder", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({ ids }),
  });

export const deletePipeline = (id: number) =>
  req(`/api/admin/pipelines/${id}`, { method: "DELETE", headers: writeHeaders });

export const createStage = (input: {
  pipelineId: number;
  name: string;
  probability?: number;
  rottingDays?: number | null;
  requiredFields?: string[];
}) =>
  req<AdminStageRow>("/api/admin/stages", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify(input),
  });

export const updateStage = (
  id: number,
  patch: {
    name?: string;
    probability?: number;
    rottingDays?: number | null;
    requiredFields?: string[];
    archived?: boolean;
  },
) =>
  req<AdminStageRow>(`/api/admin/stages/${id}`, {
    method: "PATCH",
    headers: writeHeaders,
    body: JSON.stringify(patch),
  });

export const reorderStages = (pipelineId: number, ids: number[]) =>
  req("/api/admin/stages/reorder", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({ pipelineId, ids }),
  });

export const deleteStage = (id: number, reassignToStageId?: number) =>
  req(`/api/admin/stages/${id}`, {
    method: "DELETE",
    headers: writeHeaders,
    body: JSON.stringify(reassignToStageId ? { reassignToStageId } : {}),
  });

// Invalidate the admin lists AND every app view that reads pipelines/stages, so
// the board / funnel / toolbar / filters refetch live. Passing the key builders
// with no args yields a prefix that matches all param variants.
export function invalidatePipelineData(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["admin-pipelines"] });
  qc.invalidateQueries({ queryKey: ["admin-stages"] });
  qc.invalidateQueries({ queryKey: getListPipelinesQueryKey() });
  qc.invalidateQueries({ queryKey: getListStagesQueryKey() });
  qc.invalidateQueries({ queryKey: getGetBoardQueryKey() });
  qc.invalidateQueries({ queryKey: getGetPipelineFunnelQueryKey() });
}
