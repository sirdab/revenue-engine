import { useCallback, useEffect, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useListDealViews } from "@workspace/api-client-react";
import type { UserPreferencesDealsState } from "@workspace/api-client-react";
import { usePreference } from "@/hooks/use-user-preferences";

// The Deals workspace keeps all shareable view state in the URL so any view is
// bookmarkable and shareable. Saved views (deal_views table) persist a named
// snapshot of this same state; column widths are a server-backed preference
// (see use-user-preferences). When /deals has no explicit query params at
// all, this hook fills in a saved default: the user's pinned "default view"
// (deals.defaultViewId) if set, else their last explicit working state
// (deals.lastState) — and then MATERIALIZES that state into the URL with a
// replace-navigation. Saved state must never be invisible: leaving the URL
// bare while silently narrowing the query made records "disappear" depending
// on how the user navigated here (sidebar link vs. tab click), with no
// indication in the toolbar and no way to see, share, or clear what was
// applied.

export type DealsView = "pipeline" | "list" | "forecast" | "funnel";

const VIEWS: readonly DealsView[] = ["pipeline", "list", "forecast", "funnel"];

/** Status lens for the list view. `all` = every status (still non-archived). */
export type DealsStatus = "open" | "won" | "lost" | "deleted" | "all";

// The old "Archive" tab was a closed-deals lens wearing a misleading name: it
// filtered status IN (won, lost, deleted) and had nothing to do with the
// `archived` column. It is now the `status` control on the list view. Old
// URLs, saved views and persisted lastState still carry view=archive, so
// translate it on read rather than migrating rows — `all` is the closest
// honest equivalent (it also includes open deals, which the tab excluded).
const LEGACY_ARCHIVE_VIEW = "archive";

function isLegacyArchiveView(view: string | null | undefined): boolean {
  return view === LEGACY_ARCHIVE_VIEW;
}

export const DEFAULT_LIMIT = 30;
// Server-enforced bound (openapi: limit 1–200); mirrored here so a hand-edited
// or stale URL degrades to a valid request instead of a 400.
const MAX_LIMIT = 200;

export interface DealsUrlState {
  view: DealsView;
  pipelineId?: number;
  ownerId?: number;
  status?: string;
  sort?: string;
  /** base64url-encoded JSON filter group. */
  filters?: string;
  /** Archived lens: true = show only archived (read-only) deals. */
  archived?: boolean;
  /** Free-text search across deal title, contact, and organization. */
  q?: string;
  page: number;
  limit: number;
}

function num(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Integer clamped to [min, max]; anything unparsable falls back. */
function intInRange(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = num(params, key);
  if (n == null) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** A valid DealsView, or undefined for anything else (including null/missing). */
function sanitizeView(view: string | null | undefined): DealsView | undefined {
  return view != null && (VIEWS as readonly string[]).includes(view)
    ? (view as DealsView)
    : undefined;
}

/** Integer clamped to [1, MAX_LIMIT], or undefined for anything else. */
function sanitizeLimit(limit: number | null | undefined): number | undefined {
  if (limit == null || !Number.isFinite(limit)) return undefined;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

/** Exported for tests: the legacy `view=archive` translation lives here. */
export function parse(search: string): DealsUrlState {
  const p = new URLSearchParams(search);
  const rawView = p.get("view") ?? "";
  const legacyArchive = isLegacyArchiveView(rawView);
  const view = (VIEWS as readonly string[]).includes(rawView)
    ? (rawView as DealsView)
    : "list";
  return {
    view,
    pipelineId: num(p, "pipelineId"),
    ownerId: num(p, "ownerId"),
    // A legacy ?view=archive URL lands on the list with the All status lens.
    status: p.get("status") ?? (legacyArchive ? "all" : undefined),
    sort: p.get("sort") ?? undefined,
    filters: p.get("filters") ?? undefined,
    archived: p.get("archived") === "1" ? true : undefined,
    q: p.get("q") || undefined,
    page: intInRange(p, "page", 1, Number.MAX_SAFE_INTEGER, 1),
    limit: intInRange(p, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT),
  };
}

function build(state: DealsUrlState): string {
  const p = new URLSearchParams();
  p.set("view", state.view);
  if (state.pipelineId != null) p.set("pipelineId", String(state.pipelineId));
  if (state.ownerId != null) p.set("ownerId", String(state.ownerId));
  if (state.status) p.set("status", state.status);
  if (state.sort) p.set("sort", state.sort);
  if (state.filters) p.set("filters", state.filters);
  if (state.archived) p.set("archived", "1");
  if (state.q) p.set("q", state.q);
  if (state.page && state.page !== 1) p.set("page", String(state.page));
  if (state.limit && state.limit !== DEFAULT_LIMIT)
    p.set("limit", String(state.limit));
  const qs = p.toString();
  return qs ? `/deals?${qs}` : "/deals";
}

const EMPTY_LAST_STATE: UserPreferencesDealsState = {};

export function useDealsUrlState() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlState = useMemo(() => parse(search), [search]);
  const hasExplicitParams = search.length > 0;

  const [defaultViewId] = usePreference<number | null>(
    "deals.defaultViewId",
    null,
  );
  const [lastState, setLastState] = usePreference<UserPreferencesDealsState>(
    "deals.lastState",
    EMPTY_LAST_STATE,
  );
  const { data: savedViews } = useListDealViews();
  const defaultView =
    defaultViewId != null
      ? savedViews?.find((v) => v.id === defaultViewId)
      : undefined;
  // A pinned default view outranks lastState, but the two sources load
  // independently (saved views vs. the preferences doc). Until the saved
  // views arrive we can't resolve a pinned view's definition, so treat it as
  // pending — otherwise materialization below could freeze a lastState URL and
  // the pinned view would never apply.
  const defaultViewPending = defaultViewId != null && savedViews === undefined;

  // No explicit query params at all: fill in the pinned default view, else
  // the last explicit working state, else the hard-coded defaults from
  // parse(""). Any explicit param present short-circuits straight to it.
  const state: DealsUrlState = useMemo(() => {
    if (hasExplicitParams) return urlState;
    if (defaultView) {
      const d = defaultView.definition;
      return {
        ...urlState,
        view: sanitizeView(d.view) ?? urlState.view,
        pipelineId: d.pipelineId ?? undefined,
        ownerId: d.ownerId ?? undefined,
        status: d.status ?? (isLegacyArchiveView(d.view) ? "all" : undefined),
        sort: d.sort ?? undefined,
        filters: d.filters ?? undefined,
      };
    }
    if (Object.keys(lastState).length > 0) {
      return {
        ...urlState,
        view: sanitizeView(lastState.view) ?? urlState.view,
        pipelineId: lastState.pipelineId ?? undefined,
        ownerId: lastState.ownerId ?? undefined,
        status:
          lastState.status ??
          (isLegacyArchiveView(lastState.view) ? "all" : undefined),
        sort: lastState.sort ?? undefined,
        filters: lastState.filters ?? undefined,
        // `archived` is a tri-state lens: on (true) or off (absent). It must
        // never hydrate to the boolean `false` — that value flows through to
        // the API as `archived=false`, which the query-param zod coerces back
        // to `true` (Boolean("false") === true), inverting the filter to
        // archived-only. Restore the lens only when it was explicitly on;
        // anything else (including a legacy persisted `false`) leaves it off.
        archived: lastState.archived === true ? true : urlState.archived,
        limit: sanitizeLimit(lastState.limit) ?? urlState.limit,
      };
    }
    return urlState;
  }, [hasExplicitParams, urlState, defaultView, lastState]);

  // Make the hydrated default visible: as soon as saved state fills in (the
  // preferences/saved-views queries resolve async), rewrite the bare URL to
  // the explicit equivalent. replace (not push) keeps Back working, and the
  // guard against the clean default avoids pointless churn when there is no
  // saved state to show. From here on the toolbar combos, filter badge, view
  // tabs and the address bar all agree on what is applied.
  useEffect(() => {
    if (hasExplicitParams || defaultViewPending) return;
    const target = build(state);
    if (target === build(urlState)) return; // hydration changed nothing
    navigate(target, { replace: true });
  }, [hasExplicitParams, defaultViewPending, state, urlState, navigate]);

  // Mirror the latest EXPLICIT working state (not a hydrated-from-defaults
  // one) so the next no-params visit to /deals restores it. Deliberately
  // excludes `page` — resuming lands on page 1, not wherever the user
  // happened to leave off. Also deliberately excludes `q` — a leftover search
  // term silently narrowing every future visit would be worse than having no
  // persisted search at all. Skips the write when nothing changed, so the
  // explicit URL produced by materialization above (which is derived FROM
  // lastState) doesn't trigger a redundant no-op preference write per visit.
  useEffect(() => {
    if (!hasExplicitParams) return;
    const next: UserPreferencesDealsState = {
      view: urlState.view,
      pipelineId: urlState.pipelineId ?? null,
      ownerId: urlState.ownerId ?? null,
      status: urlState.status ?? null,
      sort: urlState.sort ?? null,
      filters: urlState.filters ?? null,
      archived: urlState.archived ?? false,
      limit: urlState.limit,
    };
    const unchanged =
      (lastState.view ?? null) === next.view &&
      (lastState.pipelineId ?? null) === next.pipelineId &&
      (lastState.ownerId ?? null) === next.ownerId &&
      (lastState.status ?? null) === next.status &&
      (lastState.sort ?? null) === next.sort &&
      (lastState.filters ?? null) === next.filters &&
      (lastState.archived ?? false) === next.archived &&
      (lastState.limit ?? DEFAULT_LIMIT) === next.limit;
    if (unchanged) return;
    setLastState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasExplicitParams,
    lastState,
    urlState.view,
    urlState.pipelineId,
    urlState.ownerId,
    urlState.status,
    urlState.sort,
    urlState.filters,
    urlState.archived,
    urlState.limit,
  ]);

  // Any change other than an explicit page change resets pagination to page 1,
  // since the result set typically changes shape. `replace` lets a caller that
  // fires repeatedly for one logical action (e.g. each debounced search
  // keystroke) collapse into a single history entry instead of one per call.
  const update = useCallback(
    (partial: Partial<DealsUrlState>, opts?: { replace?: boolean }) => {
      const next: DealsUrlState = { ...state, ...partial };
      if (partial.page === undefined) next.page = 1;
      navigate(build(next), opts?.replace ? { replace: true } : undefined);
    },
    [state, navigate],
  );

  return { state, update };
}
