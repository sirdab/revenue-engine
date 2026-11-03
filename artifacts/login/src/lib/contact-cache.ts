import type { QueryClient } from "@tanstack/react-query";
import {
  getGetPersonQueryKey,
  getListPersonsQueryKey,
  getGetOrganizationQueryKey,
  getListOrganizationsQueryKey,
} from "@workspace/api-client-react";
import { invalidateDealCollections } from "@/lib/deal-collections";

// Which caches an edit to one person or organization moves. A contact is
// edited from three places (its own page, and the deal page's Person and
// Organization panels) and read from more: its own page, the deal page's
// WhatsApp card (which caches the person for 10 minutes), the panels' search
// lists, and the contacts grids. Each edit path used to invalidate only its
// own key, so the others replayed the old phone or name.
//
// A rename also moves every deal view that shows the contact's name
// (personName / organizationName on the list, board and deal pages).

export function invalidatePersonCaches(
  queryClient: QueryClient,
  personId: number,
  { renamed }: { renamed: boolean },
): void {
  for (const queryKey of [
    getGetPersonQueryKey(personId),
    getListPersonsQueryKey(),
    ["persons", "search"],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  if (renamed) invalidateDealCollections(queryClient);
}

export function invalidateOrganizationCaches(
  queryClient: QueryClient,
  orgId: number,
  { renamed }: { renamed: boolean },
): void {
  for (const queryKey of [
    getGetOrganizationQueryKey(orgId),
    getListOrganizationsQueryKey(),
    ["organizations", "search"],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  if (renamed) invalidateDealCollections(queryClient);
}
