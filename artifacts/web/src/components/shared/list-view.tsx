import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type Header,
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
import { ChevronUp, ChevronDown, ChevronsUpDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/lib/i18n/i18n";
import { ColumnPicker } from "@/components/shared/column-picker";
import { useTableLayoutPreference } from "@/hooks/use-user-preferences";
import {
  TablePagination,
  useClientPagination,
} from "@/components/shared/table-pagination";
import { parseSort, formatSort } from "@/lib/table-sort";

// Generic, virtualized table with the standard list-page chrome (the
// same as Deals): a "{total} total" + column-picker bar, a
// draggable/resizable/sortable header, and a TablePagination footer. Works in
// two modes: client (a fully-loaded snapshot, sorted/paged in-memory) or server
// (the parent supplies one page + sort/pagination callbacks). Extracted so any
// entity gets the identical look with no duplication.

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
      className="relative flex shrink-0 items-center border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-300 hover:text-slate-500"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <HeaderLabel
        type={canSort ? "button" : undefined}
        onClick={canSort ? onSort : undefined}
        className={cn(
          "ms-1 flex flex-1 items-center gap-1 truncate",
          align === "right" && "justify-end",
          canSort && "cursor-pointer hover:text-slate-700",
        )}
      >
        <span className="truncate">
          {flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {canSort &&
          (sortDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-teal-600" />
          ) : sortDir === "desc" ? (
            <ChevronDown className="h-3.5 w-3.5 text-teal-600" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 text-slate-300" />
          ))}
      </HeaderLabel>
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onClick={(e) => e.stopPropagation()}
          className="absolute end-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-teal-400/60"
        />
      )}
    </div>
  );
}

/** Server-driven pagination + sorting (the parent owns the page of data). */
export interface ServerListState {
  total: number;
  page: number;
  pageSize: number;
  sort: string; // "field:dir"
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (sort: string) => void;
}

export interface ListViewProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  /** Persistence namespace, e.g. "tickets" → tables.tickets.* */
  preferenceKey: string;
  defaultColumnOrder: string[];
  defaultColumnVisibility?: Record<string, boolean>;
  /** Client-mode default sort (ignored in server mode). */
  defaultSort?: SortingState;
  /** When provided, the table is server-driven (one page in `data`). */
  server?: ServerListState;
  onRowClick?: (row: T) => void;
  /** When set, a row is clickable only if this returns true (else no cursor/handler). */
  rowClickable?: (row: T) => boolean;
  rowClassName?: (row: T) => string | undefined;
  /** When provided, small screens render a stacked card per row (via this) instead
   *  of the horizontal table — opt-in, so table-only consumers are unaffected. */
  mobileCard?: (row: T) => ReactNode;
  loading?: boolean;
  error?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
  errorMessage?: string;
  countSuffix?: ReactNode;
}

export function ListView<T>({
  data,
  columns,
  getRowId,
  preferenceKey,
  defaultColumnOrder,
  defaultColumnVisibility = {},
  defaultSort = [],
  server,
  onRowClick,
  rowClickable,
  rowClassName,
  mobileCard,
  loading,
  error,
  emptyMessage: emptyMessageProp,
  loadingMessage: loadingMessageProp,
  errorMessage: errorMessageProp,
  countSuffix,
}: ListViewProps<T>) {
  const { t } = useI18n();
  const emptyMessage = emptyMessageProp ?? t("common.noResults");
  const loadingMessage = loadingMessageProp ?? t("common.loading");
  const errorMessage = errorMessageProp ?? t("common.loadFailedDot");
  const useCards = useIsMobile() && !!mobileCard;
  const {
    visibility,
    setVisibility,
    order,
    setOrder,
    sizing,
    setSizing,
    sorting,
    setSorting,
  } = useTableLayoutPreference(
    preferenceKey,
    defaultColumnOrder,
    defaultColumnVisibility,
  );

  const isServer = server != null;
  const clientPag = useClientPagination(data.length, { preferenceKey });
  // Client mode: a new filtered array is a new result set — reset to page 1.
  useEffect(() => {
    if (!isServer) clientPag.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isServer]);

  const activeSorting = isServer
    ? parseSort(server!.sort)
    : sorting.length > 0
      ? sorting
      : defaultSort;

  // Control columns (non-sortable + non-hideable, e.g. a leading actions
  // column) are pinned to the front, even for saved orders that predate them.
  const controlIds = useMemo(
    () =>
      columns
        .filter((c) => c.enableSorting === false && c.enableHiding === false)
        .map((c) => String(c.id)),
    [columns],
  );
  const columnOrder = useMemo(() => {
    const base = order.length ? order : defaultColumnOrder;
    return [...controlIds, ...base.filter((id) => !controlIds.includes(id))];
  }, [order, defaultColumnOrder, controlIds]);

  const pageSize = isServer ? server!.pageSize : clientPag.pageSize;
  const pageIndex = (isServer ? server!.page : clientPag.page) - 1;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: activeSorting,
      columnVisibility: visibility,
      columnOrder,
      columnSizing: sizing,
      pagination: { pageIndex, pageSize },
    },
    getRowId,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    manualSorting: isServer,
    manualPagination: isServer,
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(activeSorting) : updater;
      if (isServer) server!.onSortChange(formatSort(next));
      else setSorting(next);
    },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    getCoreRowModel: getCoreRowModel(),
    ...(isServer
      ? {}
      : {
          getSortedRowModel: getSortedRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
        }),
  });

  const rows = table.getRowModel().rows;
  const headers = table.getFlatHeaders();
  const totalWidth = headers.reduce((sum, h) => sum + h.getSize(), 0);
  const isControl = (h: (typeof headers)[number]) =>
    !h.column.getCanSort() && !h.column.getCanHide();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageIndex, pageSize]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = columnOrder.indexOf(String(active.id));
    const to = columnOrder.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setOrder(arrayMove(columnOrder, from, to));
  };
  const sortableIds = headers.filter((h) => !isControl(h)).map((h) => h.column.id);

  // Pagination display values.
  const total = isServer ? server!.total : data.length;
  const page = isServer ? server!.page : clientPag.page;
  const pageCount = isServer
    ? Math.max(1, Math.ceil(total / pageSize))
    : clientPag.pageCount;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = isServer ? Math.min(page * pageSize, total) : clientPag.end;

  const statusEl = loading ? (
    <div className="flex h-40 items-center justify-center text-sm text-slate-500">
      {loadingMessage}
    </div>
  ) : error ? (
    <div className="flex h-40 items-center justify-center text-sm text-red-600">
      {errorMessage}
    </div>
  ) : rows.length === 0 ? (
    <div className="flex h-40 items-center justify-center text-sm text-slate-500">
      {emptyMessage}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden items-center justify-between border-b border-slate-200 px-4 py-2 md:flex">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{total.toLocaleString()} total</span>
          {countSuffix}
        </div>
        <ColumnPicker
          table={table}
          onReset={() => {
            setOrder(defaultColumnOrder);
            setVisibility(defaultColumnVisibility);
            setSizing({});
          }}
        />
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-auto">
        {useCards ? (
          statusEl ?? (
            <div className="flex flex-col gap-2 p-3">
              {rows.map((row) => {
                const clickable =
                  !!onRowClick &&
                  (rowClickable ? rowClickable(row.original) : true);
                return (
                  <div
                    key={row.id}
                    onClick={
                      clickable ? () => onRowClick!(row.original) : undefined
                    }
                    className={cn(
                      "rounded-lg border border-slate-200 bg-card p-3 shadow-sm",
                      clickable && "cursor-pointer active:bg-slate-50",
                      rowClassName?.(row.original),
                    )}
                  >
                    {mobileCard!(row.original)}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="sticky top-0 z-10 flex bg-slate-50">
                <SortableContext
                  items={sortableIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {headers.map((header) =>
                    isControl(header) ? (
                      <div
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className="flex shrink-0 items-center border-b border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </div>
                    ) : (
                      <DraggableHeader
                        key={header.id}
                        header={header}
                        sortDir={header.column.getIsSorted()}
                        onSort={() => header.column.toggleSorting()}
                      />
                    ),
                  )}
                </SortableContext>
              </div>
            </DndContext>

            {statusEl ?? (
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualRows.map((vr) => {
                  const row = rows[vr.index];
                  const clickable =
                    !!onRowClick &&
                    (rowClickable ? rowClickable(row.original) : true);
                  return (
                    <div
                      key={row.id}
                      onClick={
                        clickable ? () => onRowClick!(row.original) : undefined
                      }
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: vr.size,
                        transform: `translateY(${vr.start}px)`,
                      }}
                      className={cn(
                        "flex items-center border-b border-slate-100",
                        clickable && "cursor-pointer hover:bg-slate-50",
                        rowClassName?.(row.original),
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
        )}
      </div>

      <TablePagination
        page={page}
        pageCount={pageCount}
        total={total}
        start={start}
        end={end}
        pageSize={pageSize}
        onPageChange={isServer ? server!.onPageChange : clientPag.setPage}
        onPageSizeChange={isServer ? server!.onPageSizeChange : clientPag.setPageSize}
      />
    </div>
  );
}
