import type { QueryClient } from "@tanstack/react-query";
import {
  getListDealsQueryKey,
  getGetBoardQueryKey,
  getCountDealsQueryKey,
  getForecastDealsQueryKey,
  getGetDealStageSummaryQueryKey,
  getGetPipelineFunnelQueryKey,
  getGetDealQueryKey,
  getGetDealHistoryQueryKey,
} from "@workspace/api-client-react";

// Every query that renders deals in aggregate. Bare key calls give the
// endpoint-prefix key, so every params variant of each collection matches.
//
// With the app-wide 30s staleTime, a view rendered from cache does not
// background-refetch on remount — so a deal mutation that skips a collection
// leaves that view stale until a manual reload (edit a deal, return to the
// pipeline, old card). Callsites used to hand-pick keys and each
// missed different views; every deal create/update/bulk edit funnels through
// here instead. Active queries refetch immediately, unmounted ones on next
// visit.
export function invalidateDealCollections(
  queryClient: QueryClient,
  dealIds: number[] = [],
): void {
  const keys = [
    getListDealsQueryKey(),
    getGetBoardQueryKey(),
    getCountDealsQueryKey(),
    getForecastDealsQueryKey(),
    getGetDealStageSummaryQueryKey(),
    getGetPipelineFunnelQueryKey(),
    // The toolbar's count and value totals (hand-written, deals-summary-api).
    ["deals", "summary"],
    // The single-deal page/drawer caches are 30s-fresh too: pass the mutated
    // ids so a board drag or inline edit doesn't replay the pre-edit deal
    // when its page/drawer is reopened within the window.
    ...dealIds.flatMap((id) => [
      getGetDealQueryKey(id),
      getGetDealHistoryQueryKey(id),
    ]),
  ];
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
