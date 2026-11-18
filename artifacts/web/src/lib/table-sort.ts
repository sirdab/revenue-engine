import type { SortingState } from "@tanstack/react-table";

// Shared conversion between a "field:dir" sort string (URL / API param) and
// TanStack's SortingState — used by the deals and generic list-view tables.

export function parseSort(sort?: string): SortingState {
  if (!sort) return [];
  const [id, dir] = sort.split(":");
  if (!id) return [];
  return [{ id, desc: dir === "desc" }];
}

export function formatSort(sorting: SortingState): string {
  const first = sorting[0];
  return first ? `${first.id}:${first.desc ? "desc" : "asc"}` : "";
}
