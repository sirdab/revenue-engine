import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  type Header,
  type RowData,
  type Table as TanstackTable,
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
import { Button } from "@/components/ui/button";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  GripVertical,
  ChevronRight,
  Download,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ColumnPicker } from "@/components/shared/column-picker";
import { useToast } from "@/hooks/use-toast";
import type { SheetCellValue } from "@/lib/xlsx-export";
import {
  TablePagination,
  useClientPagination,
} from "@/components/shared/table-pagination";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTableLayoutPreference } from "@/hooks/use-user-preferences";
import { useI18n } from "@/lib/i18n/i18n";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "right";
    /** Plain-text header for the XLSX export. ITS PRESENCE IS WHAT MAKES A
     *  COLUMN EXPORTABLE — a column without it is skipped, which is how the
     *  checkbox and row-activator columns stay out of the file without being
     *  named anywhere. */
    exportHeader?: string;
    /** The cell's value as data rather than as a React node. The `cell`
     *  renderers return elements (money bars, pickers, badges) that a
     *  spreadsheet cannot hold, so an exportable column states its value
     *  separately. Numbers and Dates stay typed in the file; anything else is
     *  written as text, and `null` as a blank cell. */
    exportValue?: (row: TData) => import("@/lib/xlsx-export").SheetCellValue;
  }
}


// ---------------------------------------------------------------------------
// Draggable / resizable header cell
// ---------------------------------------------------------------------------

function DraggableHeader<T>({
  header,
  sortDir,
  onSort,
}: {
  header: Header<T, unknown>;
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
      className="relative flex h-control-xl shrink-0 items-center border-b border-row-divider bg-background px-3 text-label text-muted-foreground"
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
            <ChevronUp className="size-3.5 text-foreground" />
          ) : sortDir === "desc" ? (
            <ChevronDown className="size-3.5 text-foreground" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 text-subtle" />
          ))}
      </HeaderLabel>
      {/* A visible divider, so the edge reads as draggable before anyone
          happens to hover it. The hit area is wider than the line but stays
          inside the header, so the last column cannot widen the scroll area. */}
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onClick={(e) => e.stopPropagation()}
          className="group/resize absolute end-0 top-0 flex h-full w-2 cursor-col-resize touch-none select-none justify-end"
        >
          <div
            className={cn(
              "my-2.5 w-px bg-border group-hover/resize:my-0 group-hover/resize:w-0.5 group-hover/resize:bg-gray-alpha-400",
              header.column.getIsResizing() && "my-0 w-0.5 bg-foreground",
            )}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic, virtualized data table with draggable / resizable / hideable
// columns and client-side sorting. Layout state persists server-side (user
// preferences) keyed by `preferenceKey`, so every table in the app shares the
// same look and behaviour.
// ---------------------------------------------------------------------------

/**
 * Server-side pagination/sorting. When supplied, the table renders exactly the
 * `data` it's given as the current page and delegates paging/sorting upward —
 * so the view fetches one page from the DB at a time instead of holding the
 * whole table in memory. Omit it for the default in-memory behaviour.
 */
export interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}

// Stable empty default so the visibility memo doesn't churn each render.
const EMPTY_VISIBILITY: VisibilityState = {};


// The keyboard and screen-reader entry point for a clickable row.
//
// The row itself must NOT carry role="button": ARIA treats button as
// children-presentational, which would hide the row's own content — the
// amounts, the inline editors, the checkbox — from the accessibility tree and
// leave a screen reader announcing only the row's label. So the row stays a
// plain container that a mouse can click, and this is the widget that carries
// the name, the focus ring and the Enter/Space handling.
const ROW_ACTIVATOR_WIDTH = 32;

function RowActivator({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: ROW_ACTIVATOR_WIDTH }}
    >
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="rounded-sm p-0.5 text-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:text-muted-foreground"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Stable, unique row id used by react-table and the virtualizer. */
  getRowId: (row: T) => string;
  /** Semantic id for the persisted column order/visibility/sizing state,
   *  e.g. "deals", "adminUsers" — stored at `tables.<preferenceKey>.*`. */
  preferenceKey: string;
  /** Canonical column order used as the default and for "Reset columns". */
  defaultColumnOrder: string[];
  /** Columns hidden until the user opts in via the Columns menu, e.g.
   *  `{ phone: false }`. Also what "Reset columns" restores. */
  defaultColumnVisibility?: VisibilityState;
  isLoading?: boolean;
  isError?: boolean;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  estimateRowSize?: number;
  /** Provide to switch the table into server-side pagination + sorting. */
  server?: ServerPagination;
  /** Row id (from getRowId) to flash-highlight and scroll into view, e.g. after
   *  arriving from global search. */
  highlightRowId?: string | null;
  /** Extra controls rendered in the settings strip, next to the Columns
   *  menu — e.g. a table/board view switcher. */
  toolbarExtra?: React.ReactNode;
  /** Provide to put an Export button in the settings strip, which downloads
   *  the table as an .xlsx of exactly what the user is looking at: the columns
   *  they have visible, in the order they have them, over the rows in the
   *  current sort. A column joins the file by declaring `meta.exportHeader`
   *  and `meta.exportValue`; one that declares neither is skipped.
   *
   *  NOTE FOR SERVER-PAGINATED TABLES (`server`): the export can only see the
   *  rows the client has, so it would cover the current PAGE rather than the
   *  whole result set. Don't wire it to one of those without deciding that is
   *  what you want. */
  exportSheet?: {
    /** Filename offered to the browser; ".xlsx" is appended if absent. */
    fileName: string;
    /** Worksheet tab name. Sanitized to Excel's rules. */
    sheetName?: string;
  };
  /** Provide to make rows clickable — e.g. to open a detail panel. Cells
   *  that own their own click (links, menus, inline editors) must call
   *  stopPropagation, as they already do. Clickable rows are also focusable
   *  and open on Enter or Space; see `rowActionLabel`. */
  onRowClick?: (row: T) => void;
  /** The accessible name for the row's activator, e.g. "Open activity for
   *  Acme". Falls back to a generic name, but give it one: it is what a
   *  screen reader announces for the control that opens the row. */
  rowActionLabel?: (row: T) => string;
  /** Provide to enable row selection. The parent owns the state and supplies
   *  its own checkbox column (so it controls placement and header behavior). */
  selection?: {
    rowSelection: RowSelectionState;
    onRowSelectionChange: OnChangeFn<RowSelectionState>;
  };
}

// ---------------------------------------------------------------------------
// Export to .xlsx
//
// WHAT THE FILE CONTAINS IS READ OFF THE LIVE TABLE, not off the data the
// parent passed in. `getVisibleLeafColumns()` is the user's current visibility
// AND their current drag-order, and `getRowModel()` is the current sort and
// filter — so the sheet matches the screen by construction rather than by two
// places agreeing to stay in step.
//
// A column opts in with `meta.exportHeader` + `meta.exportValue`; the checkbox
// and row-activator columns simply never declare them and so are skipped
// without being named here.
function ExportButton<T>({
  table,
  spec,
  disabled,
}: {
  table: TanstackTable<T>;
  spec: { fileName: string; sheetName?: string };
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const columns = table
        .getVisibleLeafColumns()
        .map((c) => {
          const meta = c.columnDef.meta;
          if (!meta?.exportHeader || !meta.exportValue) return null;
          const value = meta.exportValue;
          return { header: meta.exportHeader, value: (row: T) => value(row) };
        })
        .filter((c): c is { header: string; value: (row: T) => SheetCellValue } => c !== null);
      if (columns.length === 0) {
        toast({ title: t("table.export.nothingToExport"), variant: "destructive" });
        return;
      }
      // exceljs is a megabyte of spreadsheet machinery; it loads here, on the
      // click, and never in the main bundle.
      const { downloadXlsx } = await import("@/lib/xlsx-export");
      await downloadXlsx({
        rows: table.getRowModel().rows.map((r) => r.original),
        columns,
        fileName: spec.fileName,
        sheetName: spec.sheetName,
      });
    } catch (e: unknown) {
      toast({
        title: t("table.export.failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="h-8 gap-1.5"
      disabled={disabled || busy}
      onClick={() => void run()}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {t("table.export")}
    </Button>
  );
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  preferenceKey,
  defaultColumnOrder,
  defaultColumnVisibility = EMPTY_VISIBILITY,
  isLoading = false,
  isError = false,
  loadingMessage: loadingMessageProp,
  errorMessage: errorMessageProp,
  emptyMessage: emptyMessageProp,
  estimateRowSize = 56,
  server,
  highlightRowId = null,
  toolbarExtra,
  exportSheet,
  onRowClick,
  rowActionLabel,
  selection,
}: DataTableProps<T>) {
  const serverMode = !!server;
  const {
    visibility: columnVisibility,
    setVisibility: setColumnVisibility,
    order: columnOrder,
    setOrder: setColumnOrder,
    sizing: columnSizing,
    setSizing: setColumnSizing,
  } = useTableLayoutPreference(
    preferenceKey,
    defaultColumnOrder,
    defaultColumnVisibility,
  );
  // Merge the hidden-by-default map UNDER the stored visibility, so columns a
  // table ships hidden (e.g. the extra "all fields" columns) stay hidden even
  // for users who already have saved column prefs — a stored map that predates
  // those columns simply omits them, and tanstack would otherwise show them.
  // A user's explicit choice (present in the stored map) always wins.
  const effectiveVisibility = useMemo(
    () => ({ ...defaultColumnVisibility, ...columnVisibility }),
    [defaultColumnVisibility, columnVisibility],
  );
  // Client-side sort is intentionally per-visit (in-memory), matching the
  // pre-preferences behaviour: unlike column order/visibility/sizing (which
  // persist server-side via useTableLayoutPreference), a table opens unsorted
  // on each visit rather than silently reopening a sort from another session
  // or device. In server mode the parent owns sorting (it may persist it via
  // useServerTablePreferences) and passes it through `server`.
  const { t } = useI18n();
  const loadingMessage = loadingMessageProp ?? t("common.loading");
  const errorMessage = errorMessageProp ?? t("common.loadFailedDot");
  const emptyMessage = emptyMessageProp ?? t("table.noMatches");
  const [localSorting, setLocalSorting] = useState<SortingState>([]);

  // Guard the effective sorting against sort entries that reference a column
  // that no longer exists (e.g. a dropped/renamed column, or a stale
  // parent-persisted sort in server mode) — otherwise the table sorts by a
  // phantom column id. A column's resolved id is its `id` or, absent that, its
  // string `accessorKey`; collect both so the check is a safe superset.
  const validColumnIds = useMemo(() => {
    const ids = new Set<string>();
    for (const col of columns) {
      if (col.id) ids.add(col.id);
      const accessorKey = (col as { accessorKey?: unknown }).accessorKey;
      if (typeof accessorKey === "string") ids.add(accessorKey);
    }
    return ids;
  }, [columns]);
  // A stored order predates any column added since it was saved, and tanstack
  // appends ids it doesn't list — dumping a new column at the far right, past
  // the row actions. Splice the unlisted ones back in at their default-order
  // neighbours instead, so a table that ships a new column shows it where the
  // table intends for everyone, not only for users with no saved order.
  const effectiveColumnOrder = useMemo(() => {
    if (!columnOrder.length) return columnOrder;
    const stored = new Set(columnOrder);
    const unlisted = defaultColumnOrder.filter((id) => !stored.has(id));
    if (!unlisted.length) return columnOrder;
    const merged = [...columnOrder];
    for (const id of unlisted) {
      const defaultIndex = defaultColumnOrder.indexOf(id);
      // Insert after the nearest preceding column that the stored order knows.
      // A column the table prepends (default index 0) has no predecessor and
      // must land first, not fall through to the far right.
      let at = defaultIndex === 0 ? 0 : merged.length;
      for (let i = defaultIndex - 1; i >= 0; i--) {
        const anchor = merged.indexOf(defaultColumnOrder[i]!);
        if (anchor !== -1) {
          at = anchor + 1;
          break;
        }
      }
      merged.splice(at, 0, id);
    }
    return merged;
  }, [columnOrder, defaultColumnOrder]);

  const rawSorting = server ? server.sorting : localSorting;
  const sorting = useMemo(
    () => rawSorting.filter((entry) => validColumnIds.has(entry.id)),
    [rawSorting, validColumnIds],
  );
  const isMobile = useIsMobile();

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility: effectiveVisibility,
      columnOrder: effectiveColumnOrder,
      columnSizing,
      ...(selection ? { rowSelection: selection.rowSelection } : {}),
    },
    getRowId,
    enableRowSelection: !!selection,
    ...(selection
      ? { onRowSelectionChange: selection.onRowSelectionChange }
      : {}),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    manualSorting: serverMode,
    manualPagination: serverMode,
    getCoreRowModel: getCoreRowModel(),
    ...(serverMode ? {} : { getSortedRowModel: getSortedRowModel() }),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (server) server.onSortingChange(next);
      else setLocalSorting(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const rows = table.getRowModel().rows;
  const totalWidth = table.getTotalSize();

  // Client-side pagination (30 / 50 / 80 rows / page). In server mode the parent
  // owns paging; this still runs (hooks are unconditional) but its values are
  // ignored below.
  const client = useClientPagination(serverMode ? 0 : rows.length, {
    preferenceKey,
  });

  const page = server ? server.page : client.page;
  const pageSize = server ? server.pageSize : client.pageSize;
  const total = server ? server.total : rows.length;
  const pageCount = server
    ? Math.max(1, Math.ceil(total / pageSize))
    : client.pageCount;
  const start = server
    ? total === 0
      ? 0
      : (page - 1) * pageSize + 1
    : client.start;
  const end = server ? (page - 1) * pageSize + rows.length : client.end;
  const pagedRows = server
    ? rows
    : rows.slice(client.startIndex, client.endIndex);
  const onPageChange = server ? server.onPageChange : client.setPage;
  const onPageSizeChange = server
    ? server.onPageSizeChange
    : client.setPageSize;

  // Reset to page 1 when the data set changes (client mode only — in server
  // mode the parent controls the page).
  useEffect(() => {
    if (!serverMode) client.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: pagedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowSize,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Return to the top of the scroll area on page / page-size change.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page, pageSize]);

  // Scroll a highlighted row (e.g. the target of a global-search deep link)
  // into view once it is present in the current page.
  useEffect(() => {
    if (!highlightRowId || isMobile) return;
    const localIndex = pagedRows.findIndex((r) => r.id === highlightRowId);
    if (localIndex < 0) return;
    const raf = requestAnimationFrame(() =>
      rowVirtualizer.scrollToIndex(localIndex, { align: "center" }),
    );
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRowId, pagedRows.length, isMobile]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Drag operates on the order the user is looking at (spliced), not the
    // stored one — otherwise dropping next to a newly-added column no-ops.
    const current = effectiveColumnOrder.length
      ? effectiveColumnOrder
      : defaultColumnOrder;
    const oldIndex = current.indexOf(active.id as string);
    const newIndex = current.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    setColumnOrder(arrayMove(current, oldIndex, newIndex));
  };

  // The row-selection column is fixed in place, as in the deals list.
  const sortableIds = useMemo(
    () =>
      headers.filter((h) => h.column.id !== "select").map((h) => h.column.id),
    [headers],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Column settings */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-caption text-subtle">
          {isLoading ? (
            <Skeleton className="h-3 w-16" />
          ) : (
            <>
              {total.toLocaleString()} {serverMode ? "total" : "shown"}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbarExtra}
          {exportSheet && (
            <ExportButton
              table={table}
              spec={exportSheet}
              disabled={!!isLoading || !!isError || rows.length === 0}
            />
          )}
          <ColumnPicker
            table={table}
            onReset={() => {
              setColumnOrder(defaultColumnOrder);
              setColumnVisibility(defaultColumnVisibility);
              setColumnSizing({});
            }}
          />
        </div>
      </div>

      {/* Grid (desktop) / cards (mobile) */}
      {isMobile ? (
        <div ref={scrollRef} className="flex-1 overflow-auto bg-background p-3">
          {isLoading ? (
            <div
              className="space-y-3"
              aria-busy="true"
              aria-label={loadingMessage}
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="space-y-2.5 rounded-2xl bg-card p-3.5 shadow-card"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex h-40 items-center justify-center text-body text-destructive">
              {errorMessage}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-body text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <div className="space-y-3">
              {pagedRows.map((row) => (
                <div
                  key={row.id}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                  className={cn(
                    "rounded-2xl bg-card p-3.5 shadow-card",
                    onRowClick && "group cursor-pointer",
                    row.id === highlightRowId && "ring-2 ring-ring",
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const header = cell.column.columnDef.header;
                    const label = typeof header === "string" ? header : null;
                    return (
                      <div
                        key={cell.id}
                        className="border-b border-border py-1.5 first:pt-0 last:border-0 last:pb-0"
                      >
                        {label && (
                          <div className="text-caption text-muted-foreground">
                            {label}
                          </div>
                        )}
                        <div className="mt-0.5 text-body text-foreground">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {onRowClick && (
                    <div className="mt-2 flex justify-end">
                      <RowActivator
                        label={rowActionLabel?.(row.original) ?? t("table.openRow")}
                        onOpen={() => onRowClick(row.original)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="relative flex-1 overflow-auto">
          <div
            style={{
              width: totalWidth + (onRowClick ? ROW_ACTIVATOR_WIDTH : 0),
              minWidth: "100%",
            }}
          >
            {/* Header */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="sticky top-0 z-10 flex bg-background">
                <SortableContext
                  items={sortableIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {headers.map((header) => {
                    // No grip for the select-all checkbox: a 40px column has
                    // no room for the grip, the padding AND the checkbox, so
                    // the checkbox was clipped to nothing and invisible.
                    if (header.column.id === "select") {
                      return (
                        <div
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className="flex h-control-xl shrink-0 items-center border-b border-row-divider bg-background px-3"
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

            {/* Body — skeleton rows shaped by the real column widths, so the
                loaded table doesn't shift when data arrives. */}
            {isLoading ? (
              <div aria-busy="true" aria-label={loadingMessage}>
                {Array.from({ length: 12 }, (_, i) => (
                  <div
                    key={i}
                    style={{ height: estimateRowSize }}
                    className="flex items-center border-b border-row-divider"
                  >
                    {headers.map((h, j) => (
                      <div
                        key={h.id}
                        style={{ width: h.getSize() }}
                        className="flex shrink-0 items-center px-3"
                      >
                        <Skeleton
                          className="h-3.5 rounded-sm"
                          style={{ width: `${45 + ((i * 7 + j * 13) % 40)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="flex h-40 items-center justify-center text-body text-destructive">
                {errorMessage}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-body text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualRows.map((vr) => {
                  const row = pagedRows[vr.index];
                  return (
                    <div
                      key={row.id}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: vr.size,
                        transform: `translateY(${vr.start}px)`,
                      }}
                      onClick={
                        onRowClick ? () => onRowClick(row.original) : undefined
                      }
                      className={cn(
                        "flex items-center border-b border-row-divider hover:bg-row-surface-hover",
                        onRowClick && "group cursor-pointer",
                        row.id === highlightRowId &&
                          "bg-row-surface-selected hover:bg-row-surface-selected-hover",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = cell.column.columnDef.meta?.align;
                        return (
                          <div
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className={cn(
                              "flex shrink-0 items-center overflow-hidden px-3 text-body",
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
                      {onRowClick && (
                        <RowActivator
                          label={
                            rowActionLabel?.(row.original) ?? t("table.openRow")
                          }
                          onOpen={() => onRowClick(row.original)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <TablePagination
        page={page}
        pageCount={pageCount}
        total={total}
        start={start}
        end={end}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
