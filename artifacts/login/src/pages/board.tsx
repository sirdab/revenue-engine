import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetBoard,
  useUpdateDeal,
  getGetBoardQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { invalidateDealCollections } from "@/lib/deal-collections";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  MeasuringStrategy,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Deal, BoardColumn } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { StretchedLink } from "@/components/shared/stretched-link";
import {
  ActivityPriorityDot,
  ActivityPriorityLegend,
} from "@/components/deals/activity-priority-dot";
import { RequiredFieldsDialog } from "@/components/deals/detail/required-fields-dialog";
import { requiredFieldsBlock } from "@/lib/deal-fields-api";
import { Money } from "@/components/shared/money";
import { dealCardLabel } from "@/lib/deal-card-label";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

const ms = (s?: string | null) => (s ? new Date(s).getTime() : 0);

// Aging counts idle days since the deal last showed life — the most recent of its
// stage change (or creation) and its last activity. Mirrors the backend rotting
// definition (queries.ts isRottingExpr: greatest(stageChange, lastActivity)), so
// logging an activity resets the badge instead of the card reading stale.
const idleDays = (deal: Deal) =>
  Math.floor(
    (Date.now() -
      Math.max(
        ms(deal.stageChangeTime || deal.addTime),
        ms(deal.lastActivityTime),
      )) /
      86400000,
  );

// How deal cards are ordered within a stage column. "manual" preserves the
// server/drag order (the board doesn't persist within-stage order); the rest
// reorder the cards client-side for display only.
type BoardSort =
  | "manual"
  | "value_desc"
  | "value_asc"
  | "added_desc"
  | "added_asc"
  | "name_asc"
  | "idle_desc";

const BOARD_SORTS: { value: BoardSort; label: MessageKey }[] = [
  { value: "manual", label: "board.sort.manual" },
  { value: "value_desc", label: "board.sort.valueDesc" },
  { value: "value_asc", label: "board.sort.valueAsc" },
  { value: "added_desc", label: "board.sort.newest" },
  { value: "added_asc", label: "board.sort.oldest" },
  { value: "name_asc", label: "board.sort.name" },
  { value: "idle_desc", label: "board.sort.idle" },
];

// closestCorners alone can't drop into an empty column: the empty column's
// droppable is one tall full-height rect whose corners are far from the
// pointer, so a small card in the neighboring column always scores closer and
// the deal lands in the wrong stage. Prefer whatever droppable the pointer is
// actually inside; fall back to closestCorners for keyboard drags and the
// gaps between columns.
const boardCollision: CollisionDetection = (args) => {
  const withinPointer = pointerWithin(args);
  return withinPointer.length > 0 ? withinPointer : closestCorners(args);
};

function compareDeals(a: Deal, b: Deal, sort: BoardSort): number {
  switch (sort) {
    case "value_desc":
      return (b.value || 0) - (a.value || 0);
    case "value_asc":
      return (a.value || 0) - (b.value || 0);
    case "added_desc":
      return ms(b.addTime) - ms(a.addTime);
    case "added_asc":
      return ms(a.addTime) - ms(b.addTime);
    case "name_asc":
      return (a.title || "").localeCompare(b.title || "");
    case "idle_desc":
      return idleDays(b) - idleDays(a);
    default:
      return 0;
  }
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

const recalc = (col: BoardColumn): BoardColumn => ({
  ...col,
  count: col.deals.length,
  sum: col.deals.reduce((s, d) => s + (d.value || 0), 0),
});

export function Board({
  pipelineId,
  ownerId,
  q,
  filters,
  onStageClick,
  onOpenDeal,
}: {
  pipelineId: number;
  ownerId?: number;
  /** The toolbar's search box, matched the same way the list matches it. */
  q?: string;
  /** The toolbar's filter builder (encoded DSL), shared with the list. */
  filters?: string;
  /** Shortcut into the filtered list view for a clicked stage column. */
  onStageClick?: (stageId: number, stageName: string) => void;
  onOpenDeal?: (dealId: number) => void;
}) {
  const { t } = useI18n();
  const boardParams = { pipelineId, ownerId, q, filters };
  // Keep the last board on screen while a new search/filter loads, as the
  // list does, instead of flashing the spinner on every change.
  const { data: board, isLoading } = useGetBoard(boardParams, {
    query: {
      queryKey: getGetBoardQueryKey(boardParams),
      placeholderData: keepPreviousData,
    },
  });
  const updateDeal = useUpdateDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeId, setActiveId] = useState<string | null>(null);
  // A drag blocked on the target stage's required fields; the modal gates the
  // retry (the board itself has already reverted to server state).
  const [requiredPrompt, setRequiredPrompt] = useState<{
    dealId: number;
    stageId: number;
    keys: string[];
    stageName?: string | null;
  } | null>(null);
  const [overrideCols, setOverrideCols] = useState<BoardColumn[] | null>(null);
  const [sort, setSort] = useState<BoardSort>("manual");
  const overrideColsRef = useRef<BoardColumn[] | null>(null);
  const dragOriginStage = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Columns for display, with deal cards ordered per the chosen sort. We don't
  // reorder mid-drag (overrideCols is the live drag arrangement), and "manual"
  // leaves the server order untouched.
  const cols = useMemo<BoardColumn[]>(() => {
    const base = overrideCols ?? board?.columns ?? [];
    if (overrideCols || sort === "manual") return base;
    return base.map((c) => ({
      ...c,
      deals: [...c.deals].sort((a, b) => compareDeals(a, b, sort)),
    }));
  }, [overrideCols, board?.columns, sort]);

  // Moving a card into another column re-mounts it there and shifts the
  // layout, which can put the pointer back over the column it just left. That
  // fires another drag-over, which moves it back, and so on until React stops
  // it with "Maximum update depth exceeded" (Sentry
  // REVENUE-ENGINE-10/-V). Ignore drag-overs until the move has painted, the
  // same guard dnd-kit's own multi-container example uses.
  const recentlyMovedRef = useRef(false);
  useEffect(() => {
    if (!recentlyMovedRef.current) return;
    const frame = requestAnimationFrame(() => {
      recentlyMovedRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [overrideCols]);

  if (isLoading) {
    // Skeleton columns matching the real board geometry, so the loaded board
    // appears in place instead of replacing a centered spinner.
    return (
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-hidden pb-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="flex-1 min-w-[200px] max-w-[420px] flex flex-col rounded-xl bg-slate-100/70 px-2 pt-3 pb-2"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 4 - (i % 3) }, (_, j) => (
                <Skeleton key={j} className="h-[88px] w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!board) return null;

  const activeDeal = activeId
    ? cols.flatMap((c) => c.deals).find((d) => String(d.id) === activeId) ?? null
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    const col = board.columns.find((c) =>
      c.deals.some((d) => String(d.id) === id),
    );
    dragOriginStage.current = col?.stageId ?? null;
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || recentlyMovedRef.current) return;
    const aId = String(active.id);
    const oId = String(over.id);
    if (aId === oId) return;

    const base = overrideColsRef.current ?? board.columns;
    const from = base.findIndex((c) =>
      c.deals.some((d) => String(d.id) === aId),
    );
    const to = oId.startsWith("col-")
      ? base.findIndex((c) => `col-${c.stageId}` === oId)
      : base.findIndex((c) => c.deals.some((d) => String(d.id) === oId));

    if (from === -1 || to === -1 || from === to) return;

    const next = base.map((c) => ({ ...c, deals: [...c.deals] }));
    const fromDeals = next[from].deals;
    const moveIdx = fromDeals.findIndex((d) => String(d.id) === aId);
    if (moveIdx === -1) return;

    const [moved] = fromDeals.splice(moveIdx, 1);
    const movedDeal = { ...moved, stageId: next[to].stageId };

    let insertAt = next[to].deals.length;
    if (!oId.startsWith("col-")) {
      const overIdx = next[to].deals.findIndex((d) => String(d.id) === oId);
      if (overIdx !== -1) insertAt = overIdx;
    }
    next[to].deals.splice(insertAt, 0, movedDeal);
    next[from] = recalc(next[from]);
    next[to] = recalc(next[to]);

    overrideColsRef.current = next;
    recentlyMovedRef.current = true;
    setOverrideCols(next);
  };

  const persistMove = async (
    id: number,
    stageId: number,
    optimisticColumns: BoardColumn[],
  ) => {
    // Await cancellation so no in-flight board fetch can resolve between the
    // optimistic write and the mutation and clobber our optimistic state.
    await queryClient.cancelQueries({
      queryKey: getGetBoardQueryKey(boardParams),
    });
    queryClient.setQueryData(getGetBoardQueryKey(boardParams), {
      ...board,
      columns: optimisticColumns,
    });
    // Cache now holds the moved card, so drop the visual override. Keeping it
    // until this point avoids a flicker back to the origin column.
    setOverrideCols(null);
    try {
      await updateDeal.mutateAsync({ id, data: { stageId } });
      toast({ title: t("board.dealMoved") });
    } catch (e) {
      // Move blocked on required fields: the invalidate below snaps the card
      // back, and the modal gates the retry.
      const block = requiredFieldsBlock(e);
      if (block) {
        setRequiredPrompt({
          dealId: id,
          stageId,
          keys: block.keys,
          stageName:
            block.stageName ??
            optimisticColumns.find((c) => c.stageId === stageId)?.stageName,
        });
      } else {
        toast({ title: t("board.moveFailed"), variant: "destructive" });
      }
    } finally {
      // Stage moves change every deal collection (list, forecast, counts…),
      // not just this board — and the deal's own page/drawer cache.
      invalidateDealCollections(queryClient, [id]);
    }
  };

  // Retry a blocked move once the modal's required fields are filled; a repeat
  // 409 (a field was cleared meanwhile) refreshes the modal's field list.
  const confirmBlockedMove = async () => {
    if (!requiredPrompt) return;
    const { dealId, stageId, stageName } = requiredPrompt;
    try {
      await updateDeal.mutateAsync({ id: dealId, data: { stageId } });
      toast({ title: t("board.dealMoved") });
      setRequiredPrompt(null);
      invalidateDealCollections(queryClient, [dealId]);
    } catch (e) {
      const block = requiredFieldsBlock(e);
      if (block) {
        setRequiredPrompt({ dealId, stageId, stageName, keys: block.keys });
      } else {
        toast({ title: t("board.moveFailed"), variant: "destructive" });
        setRequiredPrompt(null);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const aId = String(active.id);
    const prev = overrideColsRef.current;
    const origin = dragOriginStage.current;

    setActiveId(null);
    overrideColsRef.current = null;
    dragOriginStage.current = null;

    const finalStage = prev
      ? (prev.find((c) => c.deals.some((d) => String(d.id) === aId))?.stageId ??
        null)
      : null;

    // Dropped outside, no movement, or back in the origin column: nothing is
    // persisted (backend stores no card ordering). Clear the override so the
    // board reverts to server state.
    if (
      !over ||
      !prev ||
      origin == null ||
      finalStage == null ||
      finalStage === origin
    ) {
      setOverrideCols(null);
      return;
    }

    // Real stage change: keep the override on screen until persistMove writes
    // the optimistic columns into the cache, then it clears the override.
    void persistMove(parseInt(aId, 10), finalStage, prev);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverrideCols(null);
    overrideColsRef.current = null;
    dragOriginStage.current = null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: the activity-priority legend on the left, the sort control on
          the right (mirrors the list view's "Columns" button placement). Sort
          orders the deal cards within each stage; "Manual order" keeps the
          drag/server order. */}
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <ActivityPriorityLegend />
        <Select value={sort} onValueChange={(v) => setSort(v as BoardSort)}>
          <SelectTrigger
            className="h-8 w-[180px] gap-1.5 bg-card text-sm"
            aria-label={t("board.sortDeals")}
          >
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {BOARD_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {t(s.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          {cols.map((column) => (
            <BoardColumnView
              key={column.stageId}
              column={column}
              onStageClick={onStageClick}
              onOpenDeal={onOpenDeal}
            />
          ))}
        </div>

        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
          }}
        >
          {activeDeal ? <DealCardView deal={activeDeal} overlay /> : null}
        </DragOverlay>
      </DndContext>

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

function BoardColumnView({
  column,
  onStageClick,
  onOpenDeal,
}: {
  column: BoardColumn;
  onStageClick?: (stageId: number, stageName: string) => void;
  onOpenDeal?: (dealId: number) => void;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: `col-${column.stageId}` });

  return (
    <div className="flex-1 min-w-[200px] max-w-[420px] flex flex-col max-h-full rounded-xl bg-slate-100/70">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        {onStageClick ? (
          <button
            type="button"
            onClick={() => onStageClick(column.stageId, column.stageName)}
            title={t("board.viewStageInList", { stage: column.stageName })}
            className="flex min-w-0 items-center gap-1.5 rounded hover:text-teal-700"
          >
            <h3 className="text-sm font-semibold text-slate-700 truncate">
              {column.stageName}
            </h3>
            <span className="flex-shrink-0 text-[11px] font-medium text-slate-500 bg-slate-200/90 px-1.5 rounded-full leading-5">
              {column.count.toLocaleString()}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm font-semibold text-slate-700 truncate">
              {column.stageName}
            </h3>
            <span className="flex-shrink-0 text-[11px] font-medium text-slate-500 bg-slate-200/90 px-1.5 rounded-full leading-5">
              {column.count.toLocaleString()}
            </span>
          </div>
        )}
        <span className="flex-shrink-0 text-[11px] font-medium text-slate-500 tabular-nums">
          <Money value={column.sum} />
        </span>
      </div>

      <SortableContext
        id={`col-${column.stageId}`}
        items={column.deals.map((d) => String(d.id))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-[80px] px-2 pb-2 rounded-lg transition-colors",
            isOver && "bg-teal-50/60",
          )}
        >
          {column.deals.map((deal) => (
            <SortableDealCard key={deal.id} deal={deal} onOpenDeal={onOpenDeal} />
          ))}
          {column.deals.length === 0 && (
            <div className="flex-1 min-h-[80px] flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
              {t("board.dropHere")}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableDealCard({
  deal,
  onOpenDeal,
}: {
  deal: Deal;
  onOpenDeal?: (dealId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(deal.id) });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCardView deal={deal} dragging={isDragging} onOpenDeal={onOpenDeal} />
    </div>
  );
}

function DealCardView({
  deal,
  overlay,
  dragging,
  onOpenDeal,
}: {
  deal: Deal;
  overlay?: boolean;
  dragging?: boolean;
  onOpenDeal?: (dealId: number) => void;
}) {
  const days = idleDays(deal);
  const label = dealCardLabel(deal);

  return (
    <div
      className={cn(
        "bg-card relative rounded-md border border-slate-200 px-2.5 py-1.5 shadow-sm select-none",
        overlay
          ? "shadow-lg ring-2 ring-teal-400 rotate-1 cursor-grabbing"
          : "cursor-grab active:cursor-grabbing hover:border-teal-300 hover:shadow transition-[border-color,box-shadow]",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* z-10 so the dot's tooltip is hoverable above the card StretchedLink;
            mt centres it on the first line of a name that may wrap to two. */}
        <ActivityPriorityDot
          nextActivityDueDate={deal.nextActivityDueDate}
          className="relative z-10 mt-[5px]"
        />
        <StretchedLink
          href={`/deal/${deal.id}`}
          onClick={(e) => {
            if (onOpenDeal) {
              e.preventDefault();
              onOpenDeal(deal.id);
            }
          }}
          // The name wraps to two lines instead of cutting at one: most names
          // are company names, and one line of a ~200px column cut them
          // mid-word. dir="auto" lets an Arabic name lay out right-to-left
          // (and clip at its end, not its start) inside the LTR board. The
          // tooltip keeps the stored title, phone number and all.
          dir="auto"
          title={deal.title}
          className="flex-1 min-w-0 line-clamp-2 break-words text-start text-[13px] font-medium text-slate-900 leading-snug hover:text-teal-600"
        >
          {label.primary}
        </StretchedLink>
        {deal.ownerName && (
          <span
            className="mt-px flex-shrink-0 w-4 h-4 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[8px] font-semibold"
            title={deal.ownerName}
          >
            {initials(deal.ownerName)}
          </span>
        )}
      </div>

      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
        <span className="flex-shrink-0 font-semibold text-teal-700 tabular-nums">
          <Money value={deal.value} currency={deal.currency} />
        </span>
        {label.secondary && (
          <span
            dir="auto"
            title={label.secondary}
            className="min-w-0 flex-1 truncate text-start text-slate-500"
          >
            {label.secondary}
          </span>
        )}
        <span
          className={cn(
            "ms-auto flex-shrink-0 rounded px-1 text-[10px] font-medium tabular-nums",
            days > 30
              ? "bg-red-100 text-red-700"
              : days > 14
                ? "bg-orange-100 text-orange-700"
                : "text-slate-400",
          )}
        >
          {days}d
        </span>
      </div>
    </div>
  );
}
