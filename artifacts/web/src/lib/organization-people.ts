import { useQuery } from "@tanstack/react-query";
import type { Person } from "@workspace/api-client-react";

// People for an organization. The generated `/persons` endpoint only filters by
// free-text `q`, but the backend `/persons/search` route accepts an
// `organizationId` filter — so we hit it directly rather than loading the
// whole persons table.
async function fetchOrganizationPeople(orgId: number): Promise<Person[]> {
  const res = await fetch(
    `/api/persons/search?organizationId=${orgId}&limit=200&sort=name`,
    { headers: { accept: "application/json" }, credentials: "same-origin" },
  );
  if (!res.ok) {
    throw new Error(`Failed to load organization people (${res.status})`);
  }
  const body = (await res.json()) as { items: Person[] };
  return body.items;
}

export function useOrganizationPeople(orgId: number) {
  return useQuery({
    queryKey: ["organization-people", orgId],
    queryFn: () => fetchOrganizationPeople(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
