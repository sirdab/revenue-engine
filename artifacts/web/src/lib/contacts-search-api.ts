import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type {
  Person,
  Organization,
  Activity,
  Deal,
} from "@workspace/api-client-react";
import type { AsyncOption } from "@/components/ui/async-select";

// Server-paginated search hooks for the high-volume list views. They hit the
// hand-written `/{entity}/search` endpoints (uniform `{items,page,limit,total}`
// envelope) so a view fetches one page at a time instead of the whole table.

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

async function fetchPage<T>(path: string, params: object): Promise<Page<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`/api/${path}?${qs.toString()}`, {
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return (await res.json()) as Page<T>;
}

export interface PersonSearchParams {
  q?: string;
  organizationId?: number;
  ownerId?: number;
  sort?: string;
  page?: number;
  limit?: number;
}

export function usePersonSearch(params: PersonSearchParams) {
  return useQuery({
    queryKey: ["persons", "search", params],
    queryFn: () => fetchPage<Person>("persons/search", params),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export interface OrganizationSearchParams {
  q?: string;
  ownerId?: number;
  sort?: string;
  page?: number;
  limit?: number;
}

export function useOrganizationSearch(params: OrganizationSearchParams) {
  return useQuery({
    queryKey: ["organizations", "search", params],
    queryFn: () => fetchPage<Organization>("organizations/search", params),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export type ActivityBucket = "overdue" | "today" | "upcoming" | "done";

export interface ActivitySearchParams {
  q?: string;
  done?: boolean;
  type?: string;
  /** Due-date bucket relative to `today`; the server owns the semantics. */
  bucket?: ActivityBucket;
  /** The client's local calendar day (YYYY-MM-DD) anchoring the buckets. */
  today?: string;
  ownerId?: number;
  dealId?: number;
  pipelineId?: number;
  personId?: number;
  orgId?: number;
  dueFrom?: string;
  dueTo?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

/** The activity envelope also carries whole-dataset bucket counts, so summary
 *  tiles reflect the filtered set rather than the loaded page. */
export interface ActivityPage extends Page<Activity> {
  buckets: Record<ActivityBucket, number>;
}

export function useActivitySearch(params: ActivitySearchParams) {
  return useQuery({
    queryKey: ["activities", "search", params],
    queryFn: () =>
      fetchPage<Activity>("activities/search", params) as Promise<ActivityPage>,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

// Stable option-loaders for <AsyncSelect> (module-level so their identity never
// changes across renders).
export async function loadOrganizationOptions(q: string): Promise<AsyncOption[]> {
  const page = await fetchPage<Organization>("organizations/search", {
    q,
    limit: 20,
    sort: "name:asc",
  });
  return page.items.map((o) => ({
    value: String(o.id),
    label: o.name || `Organization ${o.id}`,
  }));
}

export async function loadPersonOptions(q: string): Promise<AsyncOption[]> {
  const page = await fetchPage<Person>("persons/search", { q, limit: 20 });
  return page.items.map((p) => ({
    value: String(p.id),
    label: p.name || p.email || `Person ${p.id}`,
  }));
}

export async function loadDealOptions(q: string): Promise<AsyncOption[]> {
  // The generated /deals list defaults to open deals — the right pool when
  // attaching an activity.
  const page = await fetchPage<Deal>("deals", { q, limit: 20 });
  return page.items.map((d) => ({
    value: String(d.id),
    label: d.title || `Deal ${d.id}`,
  }));
}
