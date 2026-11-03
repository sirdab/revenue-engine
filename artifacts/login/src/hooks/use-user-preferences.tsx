import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SortingState } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserPreferences,
  useResetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import type {
  UserPreferences,
  UserPreferencesPatch,
} from "@workspace/api-client-react";
import {
  getAtPath,
  sanitizeColumnSizing,
  sanitizeRecentlyViewed,
  setAtPath,
  withRecentlyViewed,
  type RecentlyViewedEntry,
} from "@/lib/preferences";

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_PAGE_SIZE_OPTIONS = [30, 50, 80] as const;

type PreferenceUpdater<T> = T | ((prev: T) => T);

interface PendingPreferenceWrite {
  cancel: () => void;
}

const pendingPreferenceWrites = new Map<symbol, PendingPreferenceWrite>();
const inFlightPreferenceWrites = new Set<Promise<unknown>>();
let preferenceWritesSuppressed = false;

function trackPreferenceWrite<T>(promise: Promise<T>): Promise<T> {
  inFlightPreferenceWrites.add(promise);
  void promise.finally(() => inFlightPreferenceWrites.delete(promise));
  return promise;
}

async function suppressAndDrainPreferenceWrites(): Promise<void> {
  preferenceWritesSuppressed = true;
  for (const write of pendingPreferenceWrites.values()) {
    write.cancel();
  }
  await Promise.allSettled([...inFlightPreferenceWrites]);
}

function resumePreferenceWrites(): void {
  preferenceWritesSuppressed = false;
}

function sanitizeSortingState(value: unknown): SortingState {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is { id: string; desc: boolean } =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string" &&
        typeof (entry as { desc?: unknown }).desc === "boolean",
    )
    .map((entry) => ({ id: entry.id, desc: entry.desc }));
}

// Tags a PATCH with the resetEpoch the caller last saw (from the cached GET
// response), so the server can tell "computed before a reset that's since
// happened elsewhere" (reject, see PreferencesResetConflictError) apart from
// an ordinary concurrent edit to another field (fine, deep-merge handles
// that — verified by 20-user-preferences-concurrency.mjs). `data` is
// whatever the caller's own useGetUserPreferences() query currently holds.
function resetEpochRequestOptions(
  data: UserPreferences | undefined,
): RequestInit | undefined {
  const epoch = data?.resetEpoch;
  if (epoch === undefined) return undefined;
  return { headers: { "X-Preferences-Reset-Epoch": String(epoch) } };
}

function isResetConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** The full per-user preferences document, server-backed and cross-device. */
export function useUserPreferences() {
  const { data, isLoading } = useGetUserPreferences();
  return { preferences: (data ?? {}) as UserPreferences, isLoading };
}

/** Most-recently-viewed deal/organization/account records, most recent first. */
export function useRecentlyViewed(): RecentlyViewedEntry[] {
  const { data } = useGetUserPreferences();
  return useMemo(() => sanitizeRecentlyViewed(data?.recentlyViewed), [data]);
}

/**
 * Records one view of a deal/organization/account detail page into the
 * server-backed recently-viewed list. Fires once per distinct `entry.href`
 * per mount (a real navigation to the same record re-mounts the page, so it
 * re-records — correctly bumping it back to the top).
 */
export function useRecordRecentlyViewed(
  entry: Omit<RecentlyViewedEntry, "viewedAt"> | null,
): void {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetUserPreferences();
  const mutation = useUpdateUserPreferences({
    request: resetEpochRequestOptions(data),
  });
  const recordedHrefRef = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !entry || recordedHrefRef.current === entry.href) return;
    recordedHrefRef.current = entry.href;
    const next = withRecentlyViewed(data?.recentlyViewed, entry);

    // Optimistic update — without this, the ⌘K "Recently viewed" list (which
    // reads this same query via useRecentlyViewed()) wouldn't show the
    // record just visited until something else happens to refetch, since
    // the generated mutation hook has no built-in cache sync of its own.
    const queryKey = getGetUserPreferencesQueryKey();
    queryClient.setQueryData<UserPreferences>(queryKey, (prev) => ({
      ...prev,
      recentlyViewed: next,
    }));

    mutation.mutate(
      { data: { recentlyViewed: next } },
      {
        onError: (error) => {
          if (isResetConflict(error)) {
            // Computed before a reset elsewhere — drop it and resync to the
            // real (reset) state rather than leaving the optimistic update
            // above pointing at data the server just rejected.
            queryClient.invalidateQueries({ queryKey });
          }
        },
      },
    );
    // Only the record identity should retrigger this — not every refetch of
    // `data` (which would otherwise re-mutate on each background refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, entry?.type, entry?.href, entry?.title]);
}

/**
 * A single namespaced preference at a dotted `path` (e.g.
 * "tables.deals.visibility"), server-backed with an optimistic local update
 * and a debounced write-through. Mirrors the ergonomics of the old
 * `useLocalStorage(key, initial)` hook so call sites swap over mechanically.
 */
export function usePreference<T>(
  path: string,
  defaultValue: T,
  options?: { debounceMs?: number },
): readonly [T, (value: PreferenceUpdater<T>) => void] {
  const queryClient = useQueryClient();
  const { data } = useGetUserPreferences();
  const mutation = useUpdateUserPreferences({
    request: resetEpochRequestOptions(data),
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent not-yet-sent patch, so an unmount mid-debounce can flush
  // it immediately instead of leaving an orphaned timer to fire later -
  // possibly well after remount, racing a newer write to the same path.
  const pendingPatchRef = useRef<UserPreferencesPatch | null>(null);
  const registrationIdRef = useRef(Symbol(path));

  // Preference defaults are conceptually constant per call site. Freeze the
  // first one so an *unset* preference hands back a stable reference instead of
  // a fresh {}/[] literal every render. Otherwise downstream memoization breaks
  // — e.g. react-table re-sorts the entire client-side dataset on every render,
  // which janks/freezes large tables.
  const defaultRef = useRef(defaultValue);

  const stored = data ? getAtPath<T>(data, path) : undefined;
  const value = stored ?? defaultRef.current;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    if (!patch) return;
    pendingPatchRef.current = null;
    if (preferenceWritesSuppressed) return;

    const write = mutation.mutateAsync({ data: patch }).catch((error) => {
      if (isResetConflict(error)) {
        // This write was computed before a reset that's since happened on
        // another device — it's correctly rejected, not a transient
        // failure. Refetch so the optimistic local value this hook already
        // applied gets overwritten by the real (reset) server state instead
        // of silently drifting from it.
        queryClient.invalidateQueries({ queryKey: getGetUserPreferencesQueryKey() });
        return;
      }
      // Best-effort background sync - the optimistic value already
      // rendered, so we don't interrupt the user; the next successful
      // save (or a refetch) will reconcile. Logged so a persistently
      // failing save is at least visible somewhere.
      console.error(`Failed to save preference "${path}":`, error);
    });
    void trackPreferenceWrite(write);
  }, [mutation, path, queryClient]);

  useEffect(() => {
    const id = registrationIdRef.current;
    pendingPreferenceWrites.set(id, {
      cancel: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        pendingPatchRef.current = null;
      },
    });
    return () => {
      pendingPreferenceWrites.delete(id);
    };
  }, []);

  // Flush (not silently drop) a pending debounced write when this instance
  // unmounts, so navigating away right after a change doesn't orphan a
  // setTimeout that could otherwise fire an arbitrary time later. The ref
  // indirection matters: `flush` is recreated whenever `mutation`'s identity
  // changes (react-query doesn't guarantee a stable mutation object across
  // renders), so a plain `useEffect(() => flush, [flush])` would re-run its
  // cleanup - i.e. flush a still-debouncing write early - on ordinary
  // re-renders, not just unmount. Keeping deps empty and reading the latest
  // flush via ref means the cleanup fires exactly once, on real unmount.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // The setter must keep one identity for the life of the component, so it
  // reads `flush` through the ref above rather than closing over it. Callers
  // put setters in effect deps (a page syncing `?q=` into its filters with
  // `[urlQuery, setFilters]`); while the setter changed on every render, that
  // effect re-ran on every render and wrote again, which React stopped with
  // "Maximum update depth exceeded" (Sentry REVENUE-ENGINE-B).
  const setValue = useCallback(
    (updater: PreferenceUpdater<T>) => {
      const queryKey = getGetUserPreferencesQueryKey();
      // Assigned synchronously inside the setQueryData updater below (React
      // Query invokes it immediately, not deferred).
      let resolved!: T;
      queryClient.setQueryData<UserPreferences>(queryKey, (prev) => {
        const prevValue = getAtPath<T>(prev, path) ?? defaultRef.current;
        resolved =
          typeof updater === "function"
            ? (updater as (prev: T) => T)(prevValue)
            : updater;
        return setAtPath(prev ?? {}, path, resolved);
      });

      pendingPatchRef.current = setAtPath({}, path, resolved);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(
        () => flushRef.current(),
        options?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      );
    },
    [path, queryClient, options?.debounceMs],
  );

  return [value, setValue] as const;
}

/**
 * Column visibility/order/sizing (and persisted client-side sorting) for one
 * table, stored at `tables.<preferenceKey>.*`.
 */
export function useTableLayoutPreference(
  preferenceKey: string,
  defaultColumnOrder: string[],
  defaultColumnVisibility: Record<string, boolean> = {},
) {
  const base = `tables.${preferenceKey}`;
  const [visibility, setVisibility] = usePreference<Record<string, boolean>>(
    `${base}.visibility`,
    defaultColumnVisibility,
  );
  const [order, setOrder] = usePreference<string[]>(
    `${base}.order`,
    defaultColumnOrder,
  );
  const [sizing, setSizing] = usePreference<Record<string, number>>(
    `${base}.sizing`,
    {},
  );
  const [storedSorting, setStoredSortingRaw] = usePreference<SortingState>(
    `${base}.sorting`,
    [],
  );

  const setSorting = useCallback(
    (updater: PreferenceUpdater<SortingState>) => {
      setStoredSortingRaw((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: SortingState) => SortingState)(
                sanitizeSortingState(prev),
              )
            : updater;
        return sanitizeSortingState(next);
      });
    },
    [setStoredSortingRaw],
  );

  // Memoize the sanitized copies so their references stay stable across
  // renders (sanitize* always allocate). Feeding a fresh sorting/sizing array
  // into react-table every render busts its memoization and re-sorts the whole
  // client-side dataset each render. Mirrors useServerTablePreferences.
  const sanitizedSizing = useMemo(
    () => sanitizeColumnSizing(sizing),
    [sizing],
  );
  const sorting = useMemo(
    () => sanitizeSortingState(storedSorting),
    [storedSorting],
  );

  return {
    visibility,
    setVisibility,
    order,
    setOrder,
    sizing: sanitizedSizing,
    setSizing,
    sorting,
    setSorting,
  };
}

/**
 * Shared persisted state for server-paginated tables whose sort/page-size live
 * outside the generic DataTable component.
 */
export function useServerTablePreferences(
  preferenceKey: string,
  options?: {
    defaultPageSize?: number;
    pageSizeOptions?: readonly number[];
    defaultSorting?: SortingState;
  },
) {
  const defaultPageSize =
    options?.defaultPageSize ?? DEFAULT_PAGE_SIZE_OPTIONS[0];
  const pageSizeOptions = options?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const [storedPageSize, setStoredPageSize] = usePreference<number | null>(
    `tables.${preferenceKey}.pageSize`,
    null,
  );
  const [storedSorting, setStoredSortingRaw] = usePreference<SortingState>(
    `tables.${preferenceKey}.sorting`,
    options?.defaultSorting ?? [],
  );

  const pageSize =
    storedPageSize != null && pageSizeOptions.includes(storedPageSize)
      ? storedPageSize
      : defaultPageSize;
  const sorting = useMemo(
    () => sanitizeSortingState(storedSorting),
    [storedSorting],
  );

  const setPageSize = useCallback(
    (next: number) => {
      setStoredPageSize(next);
    },
    [setStoredPageSize],
  );

  const setSorting = useCallback(
    (updater: PreferenceUpdater<SortingState>) => {
      setStoredSortingRaw((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: SortingState) => SortingState)(
                sanitizeSortingState(prev),
              )
            : updater;
        return sanitizeSortingState(next);
      });
    },
    [setStoredSortingRaw],
  );

  return { pageSize, setPageSize, sorting, setSorting };
}

/** How deal clicks open: a full page navigation, or a right-side drawer. */
export type DealOpenMode = "page" | "drawer";

/**
 * Per-user preference for whether clicking into a deal opens the full page
 * (`/deal/:id`) or a right-side drawer over the current view, stored at
 * `deals.openMode` alongside the other `deals.*` preferences (see
 * `deals.defaultViewId` in use-deals-url-state.ts).
 */
export function useDealOpenMode() {
  return usePreference<DealOpenMode>("deals.openMode", "page");
}

/**
 * Wipes the current user's entire preferences document back to `{}` - every
 * namespace (layout, filterPanels, viewModes, filters, tables, kanbanSorts,
 * deals), on this device and every other one they're signed into.
 */
export function useResetPreferences() {
  const queryClient = useQueryClient();
  const mutation = useResetUserPreferences();

  const reset = useCallback(async () => {
    await suppressAndDrainPreferenceWrites();
    try {
      await mutation.mutateAsync();
      const queryKey = getGetUserPreferencesQueryKey();
      queryClient.setQueryData<UserPreferences>(queryKey, {});
      // DELETE returns 204 (no body), so the bumped resetEpoch isn't known
      // locally yet — without this, the next write in this same tab would
      // go out with no epoch header at all (skips the conflict check
      // entirely) until something else happens to refetch.
      void queryClient.invalidateQueries({ queryKey });
    } finally {
      resumePreferenceWrites();
    }
  }, [mutation, queryClient]);

  return { reset, isPending: mutation.isPending };
}
