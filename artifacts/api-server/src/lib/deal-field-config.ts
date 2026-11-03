import type { DealFieldConfig } from "@workspace/db";

/** Keep `pipelineIds` a clean list of positive integer ids, and drop the key
 *  when it is empty so "every pipeline" has exactly one representation. */
export function normalizeFieldConfig(config: DealFieldConfig): DealFieldConfig {
  if (!("pipelineIds" in config)) return config;
  const { pipelineIds, ...rest } = config;
  const ids = Array.isArray(pipelineIds)
    ? [...new Set(pipelineIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  return ids.length ? { ...rest, pipelineIds: ids } : rest;
}
