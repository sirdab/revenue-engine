import type { Pipeline } from "@workspace/api-client-react";

// Whether the signed-in user may change the owner of deals in these
// pipelines. Mirrors the server rule (api-server lib/deal-reassign.ts): an
// admin always may; anyone else may unless one of the pipelines is locked
// with `adminOnlyReassign`. A pipeline missing from the list (not loaded yet,
// or archived and so absent from GET /pipelines) reads as unlocked: the
// control shows and the server has the final word.
export function canReassignDeals(
  isAdmin: boolean,
  pipelineIds: readonly number[],
  pipelines: readonly Pick<Pipeline, "id" | "adminOnlyReassign">[],
): boolean {
  if (isAdmin) return true;
  const locked = new Set(
    pipelines.filter((p) => p.adminOnlyReassign).map((p) => p.id),
  );
  return !pipelineIds.some((id) => locked.has(id));
}
