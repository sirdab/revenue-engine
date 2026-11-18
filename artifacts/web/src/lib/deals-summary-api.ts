import { useQuery, keepPreviousData } from "@tanstack/react-query";

// Hand-written client for GET /deals/summary — per-currency value totals
// (raw + stage-probability-weighted) over the same filter surface as
// /deals/count. Powers the info popover next to the deals count.

export interface DealCurrencyTotal {
  currency: string;
  count: number;
  value: number;
  weightedValue: number;
}

export interface DealsSummary {
  count: number;
  totals: DealCurrencyTotal[];
}

export interface DealsSummaryParams {
  view?: string;
  pipelineId?: number;
  ownerId?: number;
  status?: string;
  filters?: string;
  archived?: boolean;
  q?: string;
}

async function fetchSummary(params: DealsSummaryParams): Promise<DealsSummary> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`/api/deals/summary?${qs.toString()}`, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Failed to load deals summary (${res.status})`);
  return (await res.json()) as DealsSummary;
}

export function useDealsSummary(params: DealsSummaryParams) {
  return useQuery({
    queryKey: ["deals", "summary", params],
    queryFn: () => fetchSummary(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
