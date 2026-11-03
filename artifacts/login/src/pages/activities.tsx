import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useUpdateActivity,
  useListPipelines,
  getListActivitiesQueryKey,
  getGetActivityHistoryQueryKey,
} from "@workspace/api-client-react";
import type { Activity, ActivityType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ColumnDef,
  RowSelectionState,
} from "@tanstack/react-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useActivitySearch,
  type ActivityBucket,
  type ActivitySearchParams,
} from "@/lib/contacts-search-api";
import { useToast } from "@/hooks/use-toast";
import { useDealActivityList } from "@/components/activities/mark-activity-done";
import {
  CalendarDays,
  AlertTriangle,
  Search,
  X,
  LayoutGrid,
  Table as TableIcon,
  ListChecks,
} from "lucide-react";
import { FiltersToggle } from "@/components/shared/toolbar-controls";
import {
  usePreference,
  useServerTablePreferences,
} from "@/hooks/use-user-preferences";
import { AddActivityDialog } from "@/components/activities/add-activity-dialog";
import {
  ActivityActions,
  ActivityDoneControl,
  ActivityItem,
  ActivityStatusPill,
} from "@/components/activities/shared/activity-item";
import {
  dealToView,
  type ActivitySource,
} from "@/components/activities/shared/activity-source";
import type { ActivityListController } from "@/components/activities/shared/activity-controller";
import { bucketOf, type Bucket } from "@/components/activities/shared/activity-rules";
import { ActivitiesBulkBar } from "@/components/activities/activities-bulk-bar";
import { ActivityDraftsSection } from "@/components/activities/activity-drafts-section";
import { parseISO, startOfDay } from "date-fns";
import { formatShortDate } from "@/lib/format";
import { Link, useSearchParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox } from "@/components/ui/combobox";
import {
  ACTIVITY_TYPE_CONFIG,
} from "@/components/activities/activity-fields";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { DataTable } from "@/components/shared/data-table";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// Compact inline date pill used to reschedule an open activity from the table,
// board card, and agenda row (three call sites). Non-clearable and styled to
// sit inline; the overdue state tints it red.
function ReschedulePicker({
  value,
  overdue,
  onReschedule,
}: {
  value: string | null | undefined;
  overdue: boolean;
  onReschedule: (next: string) => void;
}) {
  return (
    <DatePicker
      value={value ?? ""}
      onChange={onReschedule}
      clearable={false}
      className={cn(
        "h-auto min-h-0 w-auto gap-1.5 px-2 py-1 text-xs",
        overdue
          ? "border-destructive/30 text-destructive"
          : "border-border text-muted-foreground",
      )}
    />
  );
}

// Strip a note's rich HTML down to plain text for compact previews (e.g. the
// table row subtitle) where markup/mentions can't be rendered.
function noteToPlainText(html: string): string {
  // Paragraphs, list items and breaks become spaces first, or "<p>a</p><p>b</p>"
  // reads as "ab".
  const spaced = html.replace(/<\/(p|li|div)>|<br\s*\/?>/gi, " ");
  const text = new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

type ViewMode = "table" | "board" | "agenda";
type ActivityFiltersPreference = {
  query: string;
  typeFilter: string;
  statusFilter: string;
  pipelineFilter: string;
};

const ALL = "__all__";
// "Not done" — every open activity regardless of due-date bucket (maps to the
// server's `done=false` rather than a single bucket).
const UNDONE = "__undone__";

const BUCKET_META: Record<
  Bucket,
  { label: MessageKey; dot: string; headerText: string; headerBg: string }
> = {
  overdue: {
    label: "activity.status.overdue",
    dot: "bg-destructive",
    headerText: "text-destructive",
    headerBg: "bg-destructive-subtle",
  },
  today: {
    label: "activity.status.today",
    dot: "bg-warning",
    headerText: "text-warning",
    headerBg: "bg-warning-subtle",
  },
  upcoming: {
    label: "activity.status.upcoming",
    dot: "bg-attention",
    headerText: "text-attention",
    headerBg: "bg-attention-subtle",
  },
  done: {
    label: "activity.status.done",
    dot: "bg-brand-500",
    headerText: "text-brand",
    headerBg: "bg-brand-subtle",
  },
};

function ViewSwitcher({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-whisper p-0.5">
      {(
        [
          { key: "table", label: t("views.table"), icon: TableIcon },
          { key: "board", label: t("views.board"), icon: LayoutGrid },
          { key: "agenda", label: t("activities.view.agenda"), icon: ListChecks },
        ] as const
      ).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          // The label is hidden on phones, where the button is icon-only.
          aria-label={label}
          aria-pressed={view === key}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === key
              ? "bg-card text-brand shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

const TYPE_OPTIONS = [
  "call",
  "meeting",
  "email",
  "task",
  "deadline",
  "whatsapp",
];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function ActivitiesPage() {
  const { t } = useI18n();
  const updateActivity = useUpdateActivity();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // A stable reference day: a fresh Date each render would silently defeat
  // every memo that depends on it.
  const today = useMemo(() => startOfDay(new Date()), []);

  const [params] = useSearchParams();
  const focusParam = params.get("focus");
  const qParam = params.get("q") ?? "";
  const focusId = focusParam ? Number(focusParam) : null;

  const [view, setView] = usePreference<ViewMode>("viewModes.activities", "table");
  const [filtersOpen, setFiltersOpen] = usePreference(
    "filterPanels.activities",
    true,
  );
  const [filters, setFilters] = usePreference<ActivityFiltersPreference>(
    "filters.activities",
    {
      query: "",
      typeFilter: ALL,
      // Default to open work only — the page is a to-do list, not an archive.
      statusFilter: UNDONE,
      pipelineFilter: ALL,
    },
  );
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, sorting, setSorting } =
    useServerTablePreferences("activities", { defaultPageSize: 30 });
  const { data: pipelines } = useListPipelines();
  const { query, typeFilter, statusFilter, pipelineFilter } = filters;
  const debouncedQuery = useDebouncedValue(query.trim(), 300);

  const searchParams = useMemo<ActivitySearchParams>(() => {
    const p: ActivitySearchParams = {
      q: debouncedQuery || undefined,
      type: typeFilter !== ALL ? typeFilter : undefined,
      // "Not done" filters on the done flag; the specific due-date buckets map
      // to the server's bucket param. The server owns the bucket semantics
      // (shared with the summary counts); we just anchor them to the user's day.
      done: statusFilter === UNDONE ? false : undefined,
      bucket:
        statusFilter !== ALL && statusFilter !== UNDONE
          ? (statusFilter as ActivityBucket)
          : undefined,
      pipelineId: pipelineFilter !== ALL ? Number(pipelineFilter) : undefined,
      today: fmtDate(today),
      sort: sorting[0]
        ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`
        : undefined,
    };
    // Table paginates; board/agenda load a bounded operational window.
    if (view === "table") {
      p.page = page;
      p.limit = pageSize;
    } else {
      p.page = 1;
      p.limit = 500;
      p.sort = p.sort ?? "dueDate:asc";
    }
    return p;
  }, [debouncedQuery, typeFilter, statusFilter, pipelineFilter, sorting, view, page, pageSize, today]);

  const { data, isLoading, isError } = useActivitySearch(searchParams);
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const isMobile = useIsMobile();

  // Bulk selection (table view only). Reset whenever the underlying result
  // set changes — searchParams covers filters, sort, page, page size and view.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  useEffect(() => {
    setRowSelection({});
  }, [searchParams]);
  const selectedIds = Object.keys(rowSelection).map(Number);

  // Arriving from a global-search deep link: prefill the search and force the
  // table view so the focused row is visible and can be highlighted.
  useEffect(() => {
    if (focusId != null) {
      setFilters({
        query: qParam,
        statusFilter: ALL,
        typeFilter: ALL,
        pipelineFilter: ALL,
      });
      setView("table");
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, qParam]);

  useEffect(() => {
    if (!qParam || focusId != null) return;
    setFilters((prev) => (prev.query === qParam ? prev : { ...prev, query: qParam }));
    setPage(1);
  }, [focusId, qParam, setFilters]);

  // The page reads from the /search cache; deal timelines and other views read
  // from the generated list hooks — refresh both after any mutation.
  const invalidate = useCallback((activityId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["activities", "search"] });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    if (activityId != null) {
      queryClient.invalidateQueries({
        queryKey: getGetActivityHistoryQueryKey(activityId),
      });
    }
  }, [queryClient]);

  // Tick, edit (the shared dialog), delete and history for every row, in all
  // three views. Ticking runs the deal mark-done flow; a No reply
  // copy opens in the shared edit dialog to reschedule.
  const { source, controller, dialogs } = useDealActivityList(items, invalidate);

  const reschedule = useCallback(
    async (id: number, dueDate: string) => {
      try {
        await updateActivity.mutateAsync({
          id,
          data: { dueDate: dueDate || null },
        });
        invalidate(id);
        toast({ title: t("activities.rescheduled") });
      } catch {
        toast({ title: t("activities.rescheduleFailed"), variant: "destructive" });
      }
    },
    [updateActivity, invalidate, toast],
  );

  const typeOptions = TYPE_OPTIONS;

  // Board/agenda group the currently-loaded window (bounded fetch).
  const groups = useMemo(() => {
    const g: Record<Bucket, Activity[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      done: [],
    };
    for (const a of items) g[bucketOf(dealToView(a), today)].push(a);
    return g;
  }, [items, today]);

  // Summary tiles come from the server's whole-dataset bucket counts, not the
  // loaded page — they stay truthful on page 2 of a 1,000-row result.
  const buckets = data?.buckets;
  const summary = useMemo(() => {
    const overall = buckets
      ? buckets.overdue + buckets.today + buckets.upcoming + buckets.done
      : total;
    return [
      { label: t("common.total"), value: overall, dot: "bg-gray-400" },
      { label: t("activity.status.overdue"), value: buckets?.overdue ?? 0, dot: "bg-destructive" },
      { label: t("activity.status.today"), value: buckets?.today ?? 0, dot: "bg-warning" },
      { label: t("activity.status.done"), value: buckets?.done ?? 0, dot: "bg-brand-500" },
    ];
  }, [buckets, total, t]);

  const columns = useMemo<ColumnDef<Activity>[]>(
    () => [
      {
        id: "select",
        size: 44,
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
            aria-label={t("table.selectAll")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label={t("table.selectRow")}
          />
        ),
      },
      {
        id: "done",
        header: "",
        size: 56,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <ActivityDoneControl view={dealToView(row.original)} controller={controller} />
        ),
      },
      {
        id: "subject",
        accessorKey: "subject",
        header: t("common.subject"),
        size: 300,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div
              className={cn(
                "truncate font-medium",
                row.original.done ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {row.original.subject}
            </div>
            {row.original.note && (
              <div className="truncate text-xs text-subtle">
                {noteToPlainText(row.original.note)}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "status",
        header: t("common.status"),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => (
          <ActivityStatusPill view={dealToView(row.original)} today={today} />
        ),
      },
      {
        id: "type",
        accessorKey: "type",
        header: t("common.type"),
        size: 120,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {source.typeLabel(dealToView(row.original), t)}
          </span>
        ),
      },
      {
        id: "due",
        accessorKey: "dueDate",
        header: t("common.due"),
        size: 170,
        cell: ({ row }) => {
          const a = row.original;
          const isOverdue = bucketOf(dealToView(a), today) === "overdue";
          if (a.done) {
            return a.dueDate ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {formatShortDate(parseISO(a.dueDate))}
              </span>
            ) : (
              <span className="text-subtle">—</span>
            );
          }
          return (
            <ReschedulePicker
              value={a.dueDate}
              overdue={isOverdue}
              onReschedule={(next) => reschedule(a.id, next)}
            />
          );
        },
      },
      {
        id: "deal",
        accessorKey: "dealTitle",
        header: t("common.deal"),
        size: 200,
        cell: ({ row }) =>
          row.original.dealId ? (
            <Link
              href={`/deal/${row.original.dealId}`}
              className="truncate text-brand hover:underline"
            >
              {row.original.dealTitle || t("activities.dealFallback", { id: row.original.dealId })}
            </Link>
          ) : (
            <span className="text-subtle">—</span>
          ),
      },
      {
        id: "organization",
        accessorKey: "dealOrganizationName",
        header: t("common.organization"),
        size: 190,
        // Sorting rides the deal join the query already makes (see the
        // activities search route's sort map).
        cell: ({ row }) => {
          const { dealOrganizationId, dealOrganizationName } = row.original;
          if (dealOrganizationId == null)
            return <span className="text-subtle">—</span>;
          return (
            <Link
              href={`/organization/${dealOrganizationId}`}
              className="truncate text-brand hover:underline"
              dir="auto"
            >
              {dealOrganizationName || t("activities.orgFallback", { id: dealOrganizationId })}
            </Link>
          );
        },
      },
      {
        id: "person",
        accessorKey: "personName",
        header: t("common.person"),
        size: 170,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {row.original.personName || "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 100,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ActivityActions
              view={dealToView(row.original)}
              source={source}
              controller={controller}
            />
          </div>
        ),
      },
    ],
    [controller, source, reschedule, today],
  );

  if (isLoading)
    return (
      <div className="flex h-full flex-col" aria-busy="true">
        <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ms-auto h-8 w-24" />
        </div>
        <div className="flex-1 space-y-1.5 overflow-hidden p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </div>
      </div>
    );

  if (isError)
    return (
      <div className="m-auto mt-10 text-sm text-destructive">
        {t("activities.loadFailedRefresh")}
      </div>
    );

  const activeFilterCount = [
    query.trim() !== "",
    typeFilter !== ALL,
    // UNDONE is the page's default ("open work only"), not a user-applied
    // filter — don't badge it, matching the zero-at-default of every other page.
    statusFilter !== ALL && statusFilter !== UNDONE,
    pipelineFilter !== ALL,
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  return (
    // Desktop is a fixed-height view: the header, tiles and drafts stay put
    // and the table/board/agenda scrolls inside the space left. On phones
    // there is no space left once a few drafts are showing, so
    // below md the page takes its natural height and simply scrolls.
    <div className="flex min-h-full flex-col bg-card md:h-full md:overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
            {t("common.activities")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("activities.subtitle")}
          </p>
        </div>
        {/* Standard cluster: arrow · view switcher · primary button (no refresh). */}
        <div className="flex items-center gap-2">
          <FiltersToggle
            open={filtersOpen}
            onToggle={() => setFiltersOpen((v) => !v)}
            activeCount={activeFilterCount}
          />
          <ViewSwitcher
            view={view}
            onChange={(v) => {
              setView(v);
              setPage(1);
            }}
          />
          <AddActivityDialog onCreated={invalidate} />
        </div>
      </div>

      {filtersOpen && (
        <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-3 sm:grid-cols-4">
        {summary.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", card.dot)} />
              {card.label}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {card.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, query: e.target.value }));
              setPage(1);
            }}
            placeholder={t("activities.search")}
            className="w-full ps-8 sm:w-[240px]"
          />
        </div>

        <Combobox
          options={typeOptions}
          value={typeFilter}
          onChange={(v) => {
            setFilters((prev) => ({ ...prev, typeFilter: v }));
            setPage(1);
          }}
          allValue={ALL}
          allLabel={t("filter.allTypes")}
          placeholder={t("filter.searchTypes")}
          renderLabel={(v) => t(ACTIVITY_TYPE_CONFIG[v as ActivityType].label)}
          triggerClassName="w-[calc(50%-0.375rem)] sm:w-[150px]"
        />

        <Combobox
          items={[
            { value: UNDONE, label: t("activities.status.notDone") },
            { value: "overdue", label: t("activity.status.overdue") },
            { value: "today", label: t("activity.status.today") },
            { value: "upcoming", label: t("activity.status.upcoming") },
            { value: "done", label: t("activity.status.done") },
          ]}
          value={statusFilter}
          onChange={(v) => {
            setFilters((prev) => ({ ...prev, statusFilter: v }));
            setPage(1);
          }}
          allValue={ALL}
          allLabel={t("activities.allStatuses")}
          placeholder={t("activities.searchStatuses")}
          triggerClassName="w-[calc(50%-0.375rem)] sm:w-[150px]"
        />

        <Combobox
          items={(pipelines ?? []).map((p) => ({
            value: p.id.toString(),
            label: p.name,
          }))}
          value={pipelineFilter}
          onChange={(v) => {
            setFilters((prev) => ({ ...prev, pipelineFilter: v }));
            setPage(1);
          }}
          allValue={ALL}
          allLabel={t("activities.allPipelines")}
          placeholder={t("activities.searchPipelines")}
          triggerClassName="w-[calc(50%-0.375rem)] sm:w-[180px]"
        />

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setFilters({
                query: "",
                typeFilter: ALL,
                statusFilter: ALL,
                pipelineFilter: ALL,
              });
              setPage(1);
            }}
          >
            <X className="me-1 h-4 w-4" />
            {t("common.clear")}
          </Button>
        )}
      </div>
        </>
      )}

      {/* Your unpublished drafts — creator-only, shown regardless of view. */}
      <ActivityDraftsSection onChanged={invalidate} />

      {/* Content */}
      <div className="md:min-h-0 md:flex-1 md:overflow-hidden">
        {view === "table" ? (
          <DataTable
            data={items}
            columns={columns}
            getRowId={(a) => String(a.id)}
            highlightRowId={focusId != null ? String(focusId) : null}
            preferenceKey="activities"
            selection={{
              rowSelection,
              onRowSelectionChange: setRowSelection,
            }}
            defaultColumnOrder={[
              "select",
              "done",
              "subject",
              "status",
              "type",
              "due",
              "deal",
              "organization",
              "person",
            ]}
            isLoading={isLoading}
            isError={isError}
            loadingMessage={t("activity.loading")}
            errorMessage={t("activity.loadFailed")}
            emptyMessage={t("activities.empty")}
            server={{
              page,
              pageSize,
              total,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
              sorting,
              onSortingChange: (next) => {
                setSorting(next);
                setPage(1);
              },
            }}
          />
        ) : view === "board" ? (
          <BoardView
            groups={groups}
            source={source}
            controller={controller}
            today={today}
            onReschedule={reschedule}
          />
        ) : (
          <AgendaView
            groups={groups}
            source={source}
            controller={controller}
            today={today}
            onReschedule={reschedule}
          />
        )}
      </div>
      {view === "table" && !isMobile && selectedIds.length > 0 && (
        <ActivitiesBulkBar
          selectedIds={selectedIds}
          onDone={() => invalidate()}
          onClear={() => setRowSelection({})}
        />
      )}
      {dialogs}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board view (read-only kanban by bucket, no drag-and-drop)
// ---------------------------------------------------------------------------

interface ViewProps {
  groups: Record<Bucket, Activity[]>;
  source: ActivitySource;
  controller: ActivityListController;
  today: Date;
  onReschedule: (id: number, dueDate: string) => void;
}

function BoardView({ groups, source, controller, today, onReschedule }: ViewProps) {
  const { t } = useI18n();
  const order: Bucket[] = ["overdue", "today", "upcoming", "done"];
  return (
    // On phones each column takes (nearly) the full width and the board snaps
    // column-by-column; from `sm` up it behaves like a regular kanban strip.
    <div className="h-full snap-x snap-mandatory overflow-auto p-4 sm:snap-none">
      <div className="flex h-full min-h-0 gap-4">
        {order.map((bucket) => {
          const meta = BUCKET_META[bucket];
          const items = groups[bucket];
          return (
            <div
              key={bucket}
              className="flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-xl border border-border bg-surface-whisper/60 sm:w-80"
            >
              <div
                className={cn(
                  "flex items-center justify-between rounded-t-xl px-3 py-2.5",
                  meta.headerBg,
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-semibold",
                    meta.headerText,
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  {t(meta.label)}
                </span>
                <span className="rounded-full bg-card/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {items.length.toLocaleString()}
                </span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                {items.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-subtle">
                    {t("activities.nothingHere")}
                  </div>
                ) : (
                  items.map((a) => (
                    <ActivityCard
                      key={a.id}
                      activity={a}
                      overdue={bucket === "overdue"}
                      source={source}
                      controller={controller}
                      today={today}
                      onReschedule={(d) => onReschedule(a.id, d)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A board card: the shared parts in a card layout.
function ActivityCard({
  activity,
  overdue,
  source,
  controller,
  today,
  onReschedule,
}: {
  activity: Activity;
  overdue: boolean;
  source: ActivitySource;
  controller: ActivityListController;
  today: Date;
  onReschedule: (dueDate: string) => void;
}) {
  const { t } = useI18n();
  const view = dealToView(activity);
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 shadow-sm",
        activity.done && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <ActivityDoneControl view={view} controller={controller} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <div
              dir="auto"
              className={cn(
                "min-w-0 text-sm font-medium",
                activity.done ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {activity.subject}
            </div>
            <ActivityActions view={view} source={source} controller={controller} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium">{source.typeLabel(view, t)}</span>
            {activity.dueTime && <span>{activity.dueTime.slice(0, 5)}</span>}
            {/* The column already says open work's status; a finished card
                still says whether it was done or went unanswered. */}
            {activity.done && <ActivityStatusPill view={view} today={today} />}
          </div>
          {activity.dealId && (
            <Link
              href={`/deal/${activity.dealId}`}
              className="mt-1 block truncate text-xs text-brand hover:underline"
            >
              {activity.dealTitle || t("activities.dealFallback", { id: activity.dealId })}
            </Link>
          )}
          {activity.personName && (
            <div dir="auto" className="truncate text-xs text-muted-foreground">
              {activity.personName}
            </div>
          )}
          {!activity.done && (
            <div className="mt-2 flex items-center gap-1.5">
              {overdue && (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <ReschedulePicker
                value={activity.dueDate}
                overdue={overdue}
                onReschedule={onReschedule}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda view (grouped list)
// ---------------------------------------------------------------------------

function AgendaView({ groups, source, controller, today, onReschedule }: ViewProps) {
  const { t } = useI18n();
  const sections: Bucket[] = ["overdue", "today", "upcoming", "done"];
  const total = sections.reduce((sum, k) => sum + groups[k].length, 0);

  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t("activities.empty")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-4xl space-y-6">
        {sections.map((key) => {
          const items = groups[key];
          if (items.length === 0) return null;
          const meta = BUCKET_META[key];
          return (
            <div key={key}>
              <div className="mb-2 flex items-center gap-2">
                <h2
                  className={cn(
                    "text-sm font-semibold uppercase tracking-wider",
                    key === "overdue" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {t(meta.label)}
                </h2>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    key === "overdue"
                      ? "bg-destructive-subtle text-destructive"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {items.length.toLocaleString()}
                </span>
              </div>
              {/* The shared row; open work keeps its inline reschedule. */}
              <ul className="space-y-2.5">
                {items.map((activity) => (
                  <ActivityItem
                    key={activity.id}
                    view={dealToView(activity)}
                    source={source}
                    controller={controller}
                    today={today}
                    trailing={
                      !activity.done && (
                        <ReschedulePicker
                          value={activity.dueDate}
                          overdue={key === "overdue"}
                          onReschedule={(d) => onReschedule(activity.id, d)}
                        />
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

