import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useListInsightsDashboards,
  getListInsightsDashboardsQueryKey,
  useCreateInsightsDashboard,
  useCreateInsightsStarterDashboard,
  useUpdateInsightsDashboard,
  useDeleteInsightsDashboard,
  useDuplicateInsightsDashboard,
  useCreateInsightsWidget,
  useUpdateInsightsWidget,
  useDeleteInsightsWidget,
  useDuplicateInsightsWidget,
  useListDealOwners,
  useListPipelines,
  useListInsightsFields,
  type InsightsDashboard,
  type InsightsLayoutItem,
  type InsightsWidget,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { WidgetShell } from "@/components/insights/widget-shell";
import { WidgetBuilder, type BuilderResult } from "@/components/insights/widget-builder";
import { BoardFilterBar } from "@/components/insights/board-filter-bar";
import { DashboardGrid } from "@/components/insights/dashboard-grid";
import {
  DashboardDialogs,
  type DashboardDialogKind,
} from "@/components/insights/dashboard-dialogs";
import {
  boardStateFromParams,
  boardStateToParams,
  toGlobalFilters,
  type BoardFilters,
} from "@/components/insights/insights-data";
import { useI18n } from "@/lib/i18n/i18n";

export default function InsightsPage() {
  const { t, tPlural } = useI18n();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListInsightsDashboardsQueryKey() });

  const search = useSearch();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const { data: dashboards, isLoading } = useListInsightsDashboards();
  const { data: owners } = useListDealOwners();
  const { data: pipelines } = useListPipelines();
  const { data: fieldList } = useListInsightsFields({ scope: "deals" });
  const fields = useMemo(() => fieldList?.fields ?? [], [fieldList]);
  // Widget shells need the vocabulary of THEIR scope for inline filters; the
  // board-level filters stay in deal terms (activities widgets apply them via
  // the linked deal, server-side).
  const { data: activityFieldList } = useListInsightsFields({ scope: "activities" });
  const activityFields = useMemo(
    () => activityFieldList?.fields ?? [],
    [activityFieldList],
  );

  // Board state initializes from the URL (deep links) and writes back on
  // every change, so any view is shareable.
  const initial = useMemo(() => boardStateFromParams(search), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedId, setSelectedId] = useState<number | null>(initial.dashboardId);
  const [filters, setFilters] = useState<BoardFilters>(initial.filters);

  const dashboard: InsightsDashboard | undefined =
    dashboards?.find((d) => d.id === selectedId) ?? dashboards?.[0];
  const readOnly = !!dashboard && !!user && dashboard.ownerId !== user.id;

  useEffect(() => {
    const params = boardStateToParams(dashboard?.id ?? null, filters);
    const qs = params.toString();
    navigate(`/insights${qs ? `?${qs}` : ""}`, { replace: true });
  }, [dashboard?.id, filters, navigate]);

  // A deep link to a board the user can no longer open (deleted, or un-shared)
  // silently falls back to their first board and rewrites the URL. Say so once,
  // rather than leaving the user wondering why the link didn't land.
  const notFoundNotified = useRef(false);
  useEffect(() => {
    if (!dashboards || notFoundNotified.current) return;
    const wanted = initial.dashboardId;
    if (wanted != null && !dashboards.some((d) => d.id === wanted)) {
      notFoundNotified.current = true;
      toast({
        title: t("insights.dashboardUnavailable"),
        description: t("insights.dashboardUnavailableBody"),
      });
    }
  }, [dashboards, initial.dashboardId]);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<InsightsWidget | null>(null);
  const [dialog, setDialog] = useState<DashboardDialogKind>(null);

  const globalFilters = useMemo(() => toGlobalFilters(filters), [filters]);

  // ---- Mutations -----------------------------------------------------------

  // No global mutation error handler exists, so each save says when it failed
  // rather than leaving the user thinking it went through.
  const failed = (title: string) => (err: unknown) =>
    toast({
      title,
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    });
  const saveFailed = failed(t("common.saveFailed"));
  const deleteFailed = failed(t("common.deleteFailed"));

  const createDashboard = useCreateInsightsDashboard({
    mutation: { onSuccess: (d) => { setSelectedId(d.id); void invalidate(); }, onError: saveFailed },
  });
  const createStarter = useCreateInsightsStarterDashboard({
    mutation: { onSuccess: (d) => { setSelectedId(d.id); void invalidate(); }, onError: saveFailed },
  });
  const updateDashboard = useUpdateInsightsDashboard({
    mutation: { onSuccess: invalidate, onError: saveFailed },
  });

  // Serialized layout saves. The optimistic-concurrency token (updatedAt) is
  // meant to catch a *different* tab clobbering our layout — but the query
  // cache only learns the new token via the save's own onSuccess, which lags
  // in-flight requests. Without serialization, two quick edits fire back to
  // back and the second carries the pre-save token → the server 409s the
  // user's own change. So: keep the freshest token in a ref, never run two
  // layout saves at once, and coalesce a burst into one trailing save with
  // the up-to-date token.
  const latestUpdatedAt = useRef<string | undefined>(undefined);
  const savingLayout = useRef(false);
  const pendingLayout = useRef<InsightsLayoutItem[] | null>(null);
  // Seed/reset the token when the selected board changes (or first loads).
  useEffect(() => {
    latestUpdatedAt.current = dashboard?.updatedAt;
    pendingLayout.current = null;
  }, [dashboard?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Layout saves skip invalidation: the local grid state is authoritative
  // while the user is arranging, and a refetch mid-drag would fight it. The
  // cache still learns the new updatedAt (for the next optimistic-concurrency
  // token) via setQueryData.
  const saveLayoutMutation = useUpdateInsightsDashboard({
    mutation: {
      onSuccess: (updated) => {
        latestUpdatedAt.current = updated.updatedAt;
        queryClient.setQueryData(
          getListInsightsDashboardsQueryKey(),
          (old: InsightsDashboard[] | undefined) =>
            old?.map((d) => (d.id === updated.id ? updated : d)),
        );
      },
      onError: (err) => {
        if ((err as { status?: number }).status === 409) {
          // A genuine cross-tab conflict (our own token is always fresh now).
          // Reload the truth; a queued follow-up would 409 too, so drop it.
          pendingLayout.current = null;
          void invalidate();
          toast({
            title: t("insights.changedElsewhere"),
            description: t("insights.changedElsewhereBody"),
          });
        } else {
          toast({
            title: t("insights.saveLayoutFailed"),
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        }
      },
      onSettled: () => {
        savingLayout.current = false;
        // Flush a layout that arrived while this save was in flight — now with
        // the freshest token (advanced by onSuccess above).
        const queued = pendingLayout.current;
        if (queued) {
          pendingLayout.current = null;
          runLayoutSave(queued);
        }
      },
    },
  });
  const deleteDashboard = useDeleteInsightsDashboard({
    mutation: { onSuccess: () => { setSelectedId(null); void invalidate(); }, onError: deleteFailed },
  });
  const duplicateDashboard = useDuplicateInsightsDashboard({
    mutation: { onSuccess: (d) => { setSelectedId(d.id); void invalidate(); }, onError: saveFailed },
  });
  const createWidget = useCreateInsightsWidget({ mutation: { onSuccess: invalidate, onError: saveFailed } });
  const updateWidget = useUpdateInsightsWidget({ mutation: { onSuccess: invalidate, onError: saveFailed } });
  const deleteWidget = useDeleteInsightsWidget({ mutation: { onSuccess: invalidate, onError: deleteFailed } });
  const duplicateWidget = useDuplicateInsightsWidget({ mutation: { onSuccess: invalidate, onError: saveFailed } });

  // Fire one layout save with the freshest known token. Hoisted so the
  // mutation's onSettled (defined above) can flush a queued save.
  function runLayoutSave(layout: InsightsLayoutItem[]) {
    if (!dashboard) return;
    savingLayout.current = true;
    saveLayoutMutation.mutate({
      id: dashboard.id,
      // Stale-tab guard: the server 409s instead of letting this write clobber
      // a layout saved in another tab since we last loaded. The token is the
      // freshest we know (advanced on every save), so back-to-back edits from
      // THIS tab never false-conflict against each other.
      data: { layout, expectedUpdatedAt: latestUpdatedAt.current },
    });
  }

  const persistLayout = (layout: InsightsLayoutItem[]) => {
    if (!dashboard || readOnly) return;
    // Never run two layout saves concurrently — queue the latest and let
    // onSettled flush it with the updated token. Only the last layout in a
    // burst matters, so a newer one overwrites any queued one.
    if (savingLayout.current) {
      pendingLayout.current = layout;
      return;
    }
    runLayoutSave(layout);
  };

  // The builder closes only once the save lands, so a failed save keeps the
  // widget setup on screen to retry instead of discarding it.
  const onBuilderSave = (result: BuilderResult) => {
    const closeBuilder = () => {
      setBuilderOpen(false);
      setEditing(null);
    };
    if (editing) {
      updateWidget.mutate(
        {
          id: editing.id,
          data: { name: result.name, spec: result.spec, viz: result.viz },
        },
        { onSuccess: closeBuilder },
      );
    } else if (dashboard) {
      createWidget.mutate(
        {
          data: {
            dashboardId: dashboard.id,
            name: result.name,
            spec: result.spec,
            viz: result.viz,
          },
        },
        { onSuccess: closeBuilder },
      );
    }
  };

  const ownedDashboards = (dashboards ?? []).filter(
    (d) => !user || d.ownerId === user.id,
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-whisper/80 p-4 md:p-6">
      {/* Header: the dashboard name IS the page title; switching lives on it */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 text-2xl font-semibold tracking-tight text-foreground hover:bg-gray-alpha-100"
              data-testid="dashboard-switcher"
            >
              {dashboard?.name ?? t("insights.title")}
              <ChevronDown className="mt-1 h-4 w-4 text-subtle group-hover:text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(dashboards ?? []).map((d) => (
              <DropdownMenuItem key={d.id} onClick={() => setSelectedId(d.id)}>
                <span className="flex-1">{d.name}</span>
                {user && d.ownerId !== user.id && (
                  <Share2 className="ms-2 h-3 w-3 text-subtle" />
                )}
                {d.id === dashboard?.id && <Check className="ms-2 h-4 w-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDialog("new")}>
              <Plus className="me-2 h-4 w-4" /> {t("insights.newDashboard")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {readOnly && (
          <Badge variant="secondary" className="gap-1">
            <Share2 className="h-3 w-3" /> {t("insights.sharedWithYou")}
          </Badge>
        )}
        <div className="ms-auto flex items-center gap-1">
          {dashboard && !readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon"
                title={t("insights.renameDashboard")}
                onClick={() => setDialog("rename")}
              >
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("insights.shareDashboard")}
                data-testid="share-dashboard"
                onClick={() => setDialog("share")}
              >
                <Share2
                  className={cn(
                    "h-4 w-4",
                    dashboard.isShared ? "text-brand" : "text-muted-foreground",
                  )}
                />
              </Button>
            </>
          )}
          {dashboard && (
            <Button
              variant="ghost"
              size="icon"
              title={t("insights.duplicateDashboard")}
              onClick={() => duplicateDashboard.mutate({ id: dashboard.id, data: {} })}
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          {dashboard && !readOnly && (
            <Button
              variant="ghost"
              size="icon"
              title={t("insights.deleteDashboard")}
              onClick={() => setDialog("delete")}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          {dashboard && !readOnly && (
            <Button
              onClick={() => {
                setEditing(null);
                setBuilderOpen(true);
              }}
              className="ms-2 gap-1.5"
              data-testid="add-widget"
            >
              <Plus className="h-4 w-4" /> {t("insights.widget")}
            </Button>
          )}
        </div>
      </div>
      {dashboard && (
        <p className="mb-4 text-sm text-muted-foreground">
          {tPlural("insights.widgetCount", dashboard.widgets.length)}
          {" · "}
          {t("insights.liveData")}
          {readOnly
            ? t("insights.viewOnly")
            : dashboard.isShared
              ? t("insights.sharedWith", { count: dashboard.sharedUserIds.length })
              : ""}
        </p>
      )}

      {/* Board filters: quick filters + Add-filter (board ∩ widget) */}
      {dashboard && (
        <BoardFilterBar
          filters={filters}
          setFilters={setFilters}
          owners={owners ?? []}
          pipelines={pipelines ?? []}
          fields={fields}
        />
      )}

      {/* Board */}
      {!dashboard ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Sparkles className="h-10 w-10 text-brand" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("insights.noDashboards")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("insights.noDashboardsBody")}
            </p>
          </div>
          <Button
            onClick={() => createStarter.mutate()}
            disabled={createStarter.isPending}
            data-testid="create-starter"
          >
            <Sparkles className="me-2 h-4 w-4" />
            {t("insights.createStarter")}
          </Button>
        </div>
      ) : dashboard.widgets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{t("insights.emptyDashboard")}</p>
          {!readOnly && (
            <Button
              onClick={() => {
                setEditing(null);
                setBuilderOpen(true);
              }}
            >
              <Plus className="me-2 h-4 w-4" /> {t("insights.addFirstWidget")}
            </Button>
          )}
        </div>
      ) : (
        <DashboardGrid
          // Remount per dashboard: drag/resize/pending-save state must never
          // leak across a board switch.
          key={dashboard.id}
          dashboard={dashboard}
          readOnly={readOnly}
          onPersist={persistLayout}
          renderWidget={(widget, controls) => (
            <WidgetShell
              widget={widget}
              globalFilters={globalFilters}
              fields={widget.spec.scope === "activities" ? activityFields : fields}
              readOnly={readOnly}
              copyTargets={ownedDashboards
                .filter((d) => d.id !== dashboard.id)
                .map((d) => ({ id: d.id, name: d.name }))}
              onEdit={() => {
                setEditing(widget);
                setBuilderOpen(true);
              }}
              onDuplicate={() => duplicateWidget.mutate({ id: widget.id, data: {} })}
              onCopyTo={(dashboardId) =>
                duplicateWidget.mutate({
                  id: widget.id,
                  data: { dashboardId, name: widget.name },
                })
              }
              onRemove={() => deleteWidget.mutate({ id: widget.id })}
              onSaveSpec={(s) =>
                updateWidget.mutate({ id: widget.id, data: { spec: s } })
              }
              onSaveAsSpec={(s) =>
                createWidget.mutate({
                  data: {
                    dashboardId: dashboard.id,
                    name: `${widget.name} (filtered)`,
                    spec: s,
                    viz: widget.viz,
                  },
                })
              }
              onMove={controls.onMove}
              dragHandleProps={controls.dragHandleProps}
            />
          )}
        />
      )}

      <WidgetBuilder
        open={builderOpen}
        initial={editing}
        onClose={() => {
          setBuilderOpen(false);
          setEditing(null);
        }}
        onSave={onBuilderSave}
        saving={createWidget.isPending || updateWidget.isPending}
      />

      <DashboardDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        dashboard={dashboard}
        owners={owners ?? []}
        currentUserId={user?.id}
        saving={createDashboard.isPending || updateDashboard.isPending}
        onCreate={(name) => createDashboard.mutate({ data: { name } })}
        onRename={(name) => {
          if (dashboard) updateDashboard.mutate({ id: dashboard.id, data: { name } });
        }}
        onShare={(ids) => {
          if (dashboard) {
            updateDashboard.mutate({
              id: dashboard.id,
              data: { isShared: ids.length > 0, sharedUserIds: ids },
            });
          }
        }}
        onDelete={() => {
          if (dashboard) deleteDashboard.mutate({ id: dashboard.id });
        }}
      />
    </div>
  );
}
