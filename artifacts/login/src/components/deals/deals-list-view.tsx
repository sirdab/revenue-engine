import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
  useListDeals,
  getListDealsQueryKey,
  useUpdateDeal,
  useListStages,
} from "@workspace/api-client-react";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { ActivityPriorityDot } from "@/components/deals/activity-priority-dot";
import type { Deal, ListDealsParams, Stage } from "@workspace/api-client-react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type Header,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RequiredFieldsDialog } from "@/components/deals/detail/required-fields-dialog";
import { requiredFieldsBlock } from "@/lib/deal-fields-api";
import { Badge } from "@/components/ui/badge";
import { ColumnPicker } from "@/components/shared/column-picker";
import { useDealCustomColumns } from "@/components/deals/deal-custom-columns";
import {
  nativeExtraColumns,
  NATIVE_EXTRA_COLUMN_IDS,
} from "@/components/deals/deal-native-columns";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Flame,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Money } from "@/components/shared/money";
import {
  EditableText,
  EditableMoney,
  EditableStage,
} from "@/components/deals/inline-edit";
import type { DealsUrlState } from "./use-deals-url-state";
import { DealsBulkBar } from "./deals-bulk-bar";
import { TablePagination } from "@/components/shared/table-pagination";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTableLayoutPreference } from "@/hooks/use-user-preferences";
import { parseSort } from "@/lib/table-sort";
import { useI18n } from "@/lib/i18n/i18n";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
  }
}

const DEFAULT_ORDER = [
  "select",
  "title",
  "organization",
  "value",
  "stage",
  "owner",
  "status",
  "addTime",
  "expectedCloseDate",
  "lastActivity",
];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-brand-subtle text-brand border-brand-200",
  won: "bg-success-subtle text-success border-success/30",
  lost: "bg-destructive-subtle text-destructive border-destructive/30",
  deleted: "bg-muted text-muted-foreground border-border",
};

// Inline-editable cells (EditableText / EditableMoney / EditableStage) are
// shared with the deal detail page; see @/components/deals/inline-edit.

// ---------------------------------------------------------------------------
// Draggable / resizable header cell
// ---------------------------------------------------------------------------

function DraggableHeader({
  header,
  sortDir,
  onSort,
}: {
  header: Header<Deal, unknown>;
  sortDir: false | "asc" | "desc";
  onSort: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useSortable({ id: header.column.id });
  const canSort = header.column.getCanSort();
  // A plain label when the column can't sort: a header like the select-all
  // checkbox is itself a button, and a button inside a button is invalid HTML.
  const HeaderLabel = canSort ? "button" : "div";
  const align = header.column.columnDef.meta?.align;

  const style: React.CSSProperties = {
    width: header.getSize(),
    transform: CSS.Translate.toString(transform),
    transition: "width 0.1s ease",
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex shrink-0 items-center border-b border-border bg-surface-whisper px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-subtle hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <HeaderLabel
        type={canSort ? "button" : undefined}
        onClick={canSort ? onSort : undefined}
        className={cn(
          "ms-1 flex flex-1 items-center gap-1 truncate",
          align === "right" && "justify-end",
          canSort && "cursor-pointer hover:text-foreground",
        )}
      >
        <span className="truncate">
          {flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {canSort &&
          (sortDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-brand" />
          ) : sortDir === "desc" ? (
            <ChevronDown className="h-3.5 w-3.5 text-brand" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 text-subtle" />
          ))}
      </HeaderLabel>
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onClick={(e) => e.stopPropagation()}
          className="absolute end-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-brand-400/60"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main grid
// ---------------------------------------------------------------------------

export function DealsListView({
  state,
  update,
  onOpenDeal,
}: {
  state: DealsUrlState;
  update: (partial: Partial<DealsUrlState>) => void;
  onOpenDeal: (dealId: number) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const updateDeal = useUpdateDeal();
  const { data: stages } = useListStages();
  const isMobile = useIsMobile();

  // Persisted grid layout state.
  const {
    visibility: columnVisibility,
    setVisibility: setColumnVisibility,
    order: columnOrder,
    setOrder: setColumnOrder,
    sizing: columnSizing,
    setSizing: setColumnSizing,
  } = useTableLayoutPreference("deals", DEFAULT_ORDER);

  // Custom-field columns (dynamic, from the registry). They default to hidden,
  // and only the visible ones are fetched — their keys go to the list API's
  // `columns` param so the server projects just those values per row.
  const { columns: customColumns, ids: customFieldIds } = useDealCustomColumns();
  // Everything not shown by default (the extra native fields + custom fields)
  // starts hidden; the column picker opts them in. Saved prefs win over this
  // map, so a user's enabled columns persist while new fields stay hidden.
  const hiddenByDefault = useMemo(
    () =>
      Object.fromEntries(
        [...NATIVE_EXTRA_COLUMN_IDS, ...customFieldIds].map((id) => [id, false]),
      ),
    [customFieldIds],
  );
  const effectiveVisibility = useMemo(
    () => ({ ...hiddenByDefault, ...columnVisibility }),
    [hiddenByDefault, columnVisibility],
  );
  const visibleCustomKeys = useMemo(
    () => customFieldIds.filter((id) => effectiveVisibility[id] === true),
    [customFieldIds, effectiveVisibility],
  );

  const params: ListDealsParams = {
    view: (state.view === "funnel"
      ? "list"
      : state.view) as ListDealsParams["view"],
    pipelineId: state.pipelineId,
    ownerId: state.ownerId,
    status: state.status as ListDealsParams["status"],
    filters: state.filters,
    archived: state.archived,
    q: state.q,
    sort: state.sort,
    page: state.page,
    limit: state.limit,
    columns: visibleCustomKeys.length ? visibleCustomKeys.join(",") : undefined,
  };

  const { data, isLoading, isError, isFetching } = useListDeals(params, {
    query: {
      queryKey: getListDealsQueryKey(params),
      placeholderData: keepPreviousData,
    },
  });

  const items: Deal[] = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Reset selection whenever the underlying result set changes.
  useEffect(() => {
    setRowSelection({});
  }, [
    state.page,
    state.sort,
    state.filters,
    state.pipelineId,
    state.ownerId,
    state.view,
    state.status,
    state.q,
  ]);

  // A stage change blocked on the target stage's required fields; the modal
  // gates the retry.
  const [requiredPrompt, setRequiredPrompt] = useState<{
    dealId: number;
    stageId: number;
    keys: string[];
    stageName: string | null;
  } | null>(null);

  // Race-protected inline commit: only invalidate once all in-flight edits
  // settle, so a refetch never clobbers a cell the user is still editing.
  const inFlight = useRef(0);
  // Deal ids edited in the current burst, so the batched invalidation below
  // also refreshes each deal's own page/drawer cache.
  const editedIds = useRef<number[]>([]);
  const commit = async (
    id: number,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    inFlight.current += 1;
    editedIds.current.push(id);
    try {
      await updateDeal.mutateAsync({ id, data: patch });
      return true;
    } catch (e) {
      const block = requiredFieldsBlock(e);
      if (block && typeof patch.stageId === "number") {
        setRequiredPrompt({ dealId: id, stageId: patch.stageId, ...block });
      }
      /* other errors are surfaced by the mutation; values revert on refetch */
      return false;
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        invalidateDealCollections(queryClient, editedIds.current);
        editedIds.current = [];
      }
    }
  };

  const confirmBlockedMove = async () => {
    if (!requiredPrompt) return;
    const ok = await commit(requiredPrompt.dealId, {
      stageId: requiredPrompt.stageId,
    });
    if (ok) setRequiredPrompt(null);
  };

  const columns = useMemo<ColumnDef<Deal>[]>(
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
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              aria-label={t("table.selectRow")}
            />
          </div>
        ),
      },
      {
        id: "title",
        accessorKey: "title",
        header: t("common.title"),
        size: 260,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <ActivityPriorityDot
              nextActivityDueDate={row.original.nextActivityDueDate}
            />
            {row.original.isRotting && (
              <Flame className="h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
            <EditableText
              value={row.original.title}
              onCommit={(next) => commit(row.original.id, { title: next })}
            />
          </div>
        ),
      },
      {
        id: "organization",
        accessorKey: "organizationName",
        header: t("common.organization"),
        size: 200,
        cell: ({ row }) => (
          <span dir="auto" className="truncate text-muted-foreground">
            {row.original.organizationName ?? "—"}
          </span>
        ),
      },
      {
        id: "value",
        accessorKey: "value",
        header: t("common.value"),
        size: 150,
        meta: { align: "right" },
        cell: ({ row }) => (
          <EditableMoney
            value={row.original.value}
            currency={row.original.currency}
            onCommit={(next) => commit(row.original.id, { value: next })}
            className="w-full text-end"
          />
        ),
      },
      {
        id: "stage",
        accessorKey: "stageName",
        header: t("common.stage"),
        size: 170,
        cell: ({ row }) => (
          <EditableStage
            deal={row.original}
            stages={stages ?? []}
            onCommit={(stageId) => commit(row.original.id, { stageId })}
          />
        ),
      },
      {
        id: "owner",
        accessorKey: "ownerName",
        header: t("common.owner"),
        size: 150,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {row.original.ownerName ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("common.status"),
        size: 110,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={cn(
              "capitalize",
              STATUS_STYLES[row.original.status] ?? STATUS_STYLES.deleted,
            )}
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "addTime",
        accessorKey: "addTime",
        header: t("common.created"),
        size: 200,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {formatDateTime(row.original.addTime)}
          </span>
        ),
      },
      {
        id: "expectedCloseDate",
        accessorKey: "expectedCloseDate",
        header: t("deals.expectedClose"),
        size: 200,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {formatDateTime(row.original.expectedCloseDate)}
          </span>
        ),
      },
      {
        id: "lastActivity",
        accessorKey: "lastActivityTime",
        header: t("deals.field.lastActivity"),
        size: 200,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {formatDateTime(row.original.lastActivityTime)}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages],
  );

  // Primary editable columns + every other native deal field (read-only,
  // default-hidden) + dynamic custom-field columns. Appended in that order so
  // enabling one lands it at the end, and all show up in the column picker.
  const allColumns = useMemo(
    () => [...columns, ...nativeExtraColumns(t), ...customColumns],
    [columns, customColumns, t],
  );

  const sorting = parseSort(state.sort);

  const table = useReactTable({
    data: items,
    columns: allColumns,
    state: {
      sorting,
      columnVisibility: effectiveVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
    },
    getRowId: (row) => String(row.id),
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      update({
        sort: first ? `${first.id}:${first.desc ? "desc" : "asc"}` : undefined,
      });
    },
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const rows = table.getRowModel().rows;
  const totalWidth = table.getTotalSize();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Reorder against the FULL effective column order (every leaf column in the
    // order the table renders it), not the persisted `columnOrder` — that array
    // seeds from DEFAULT_ORDER and lists only the default columns, so any
    // enabled extra/custom column is absent from it and indexOf returns -1,
    // making the drag a silent no-op. Rebuild the complete order the same way
    // TanStack does (columnOrder ids first, remaining leaf columns after) so
    // hidden columns keep their positions, then persist the full array.
    const leafIds = table.getAllLeafColumns().map((c) => c.id);
    const current = columnOrder.length
      ? [
          ...columnOrder.filter((id) => leafIds.includes(id)),
          ...leafIds.filter((id) => !columnOrder.includes(id)),
        ]
      : leafIds;
    const oldIndex = current.indexOf(active.id as string);
    const newIndex = current.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    setColumnOrder(arrayMove(current, oldIndex, newIndex));
  };

  const sortableIds = headers
    .filter((h) => h.column.id !== "select")
    .map((h) => h.column.id);

  const selectedIds = Object.keys(rowSelection).map(Number);

  // Pagination math.
  const start = total === 0 ? 0 : (state.page - 1) * state.limit + 1;
  const end = Math.min(state.page * state.limit, total);
  const lastPage = Math.max(1, Math.ceil(total / state.limit));

  return (
    <div className="flex h-full flex-col">
      {/* Column settings (desktop only) */}
      <div className="hidden items-center justify-between border-b border-border px-4 py-2 md:flex">
        <div className="text-xs text-subtle">
          {isFetching ? t("deals.list.updating") : t("deals.list.totalCount", { count: formatNumber(total) })}
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker
            table={table}
            onReset={() => {
              setColumnOrder(DEFAULT_ORDER);
              setColumnVisibility({});
              setColumnSizing({});
            }}
          />
        </div>
      </div>

      {/* Cards (mobile) */}
      {isMobile ? (
        <div ref={scrollRef} className="flex-1 overflow-auto bg-surface-whisper p-3">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {t("deals.list.loading")}
            </div>
          ) : isError ? (
            <div className="flex h-40 items-center justify-center text-sm text-destructive">
              {t("deals.list.loadFailed")}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {t("deals.list.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const deal = row.original;
                const facts = [
                  {
                    label: t("common.organization"),
                    value: deal.organizationName ?? "—",
                  },
                  { label: t("common.stage"), value: deal.stageName ?? "—" },
                  { label: t("common.owner"), value: deal.ownerName ?? "—" },
                  {
                    label: t("deals.expectedClose"),
                    value: formatDateTime(deal.expectedCloseDate),
                  },
                ];
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onOpenDeal(deal.id)}
                    className={cn(
                      "w-full rounded-lg border border-border bg-card p-4 text-start shadow-sm",
                      deal.isRotting && "border-s-2 border-s-destructive",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {deal.isRotting && (
                          <Flame className="h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <span
                          dir="auto"
                          className="truncate font-semibold text-foreground"
                        >
                          {deal.title}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 capitalize",
                          STATUS_STYLES[deal.status] ?? STATUS_STYLES.deleted,
                        )}
                      >
                        {deal.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
                      <Money value={deal.value} currency={deal.currency} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {facts.map((f) => (
                        <div key={f.label} className="min-w-0">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                            {f.label}
                          </div>
                          <div
                            dir="auto"
                            className="mt-0.5 truncate text-sm text-foreground"
                          >
                            {f.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="relative flex-1 overflow-auto">
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            {/* Header */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="sticky top-0 z-10 flex bg-surface-whisper">
                <SortableContext
                  items={sortableIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {headers.map((header) => {
                    if (header.column.id === "select") {
                      return (
                        <div
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className="flex shrink-0 items-center border-b border-border bg-surface-whisper px-3 py-2"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </div>
                      );
                    }
                    const sortDir = header.column.getIsSorted();
                    return (
                      <DraggableHeader
                        key={header.id}
                        header={header}
                        sortDir={sortDir}
                        onSort={() => header.column.toggleSorting()}
                      />
                    );
                  })}
                </SortableContext>
              </div>
            </DndContext>

            {/* Body */}
            {isLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {t("deals.list.loading")}
              </div>
            ) : isError ? (
              <div className="flex h-40 items-center justify-center text-sm text-destructive">
                {t("deals.list.loadFailed")}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {t("deals.list.empty")}
              </div>
            ) : (
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualRows.map((vr) => {
                  const row = rows[vr.index];
                  const deal = row.original;
                  return (
                    <div
                      key={row.id}
                      onClick={() => onOpenDeal(deal.id)}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: vr.size,
                        transform: `translateY(${vr.start}px)`,
                      }}
                      className={cn(
                        "flex cursor-pointer items-center border-b border-border hover:bg-gray-alpha-50",
                        row.getIsSelected() && "bg-brand-subtle/50",
                        deal.isRotting &&
                          "border-s-2 border-s-destructive bg-destructive-subtle/50 hover:bg-destructive-subtle",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = cell.column.columnDef.meta?.align;
                        return (
                          <div
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className={cn(
                              "flex shrink-0 items-center overflow-hidden px-3 text-sm",
                              align === "right" && "justify-end",
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pagination footer */}
      <TablePagination
        page={state.page}
        pageCount={lastPage}
        total={total}
        start={start}
        end={end}
        pageSize={state.limit}
        onPageChange={(p) => update({ page: p })}
        onPageSizeChange={(n) => update({ limit: n })}
      />

      {/* Bulk actions (desktop only; selection controls are hidden on mobile) */}
      {!isMobile && selectedIds.length > 0 && (
        <DealsBulkBar
          selectedIds={selectedIds}
          selectedPipelineIds={items
            .filter((d) => rowSelection[String(d.id)])
            .map((d) => d.pipelineId)}
          pipelineId={state.pipelineId}
          stages={stages ?? []}
          onClear={() => setRowSelection({})}
        />
      )}

      {requiredPrompt && (
        <RequiredFieldsDialog
          dealId={requiredPrompt.dealId}
          requiredKeys={requiredPrompt.keys}
          stageName={requiredPrompt.stageName}
          open
          onOpenChange={(o) => !o && setRequiredPrompt(null)}
          onConfirm={confirmBlockedMove}
          confirming={updateDeal.isPending}
        />
      )}
    </div>
  );
}
