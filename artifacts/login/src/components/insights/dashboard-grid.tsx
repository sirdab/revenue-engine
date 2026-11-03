import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  InsightsDashboard,
  InsightsLayoutItem,
  InsightsWidget,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

// ---------------------------------------------------------------------------
// The dashboard grid engine: ordered layout state, pointer drag-to-reorder,
// pointer + keyboard resize, and debounced persistence. Extracted from the
// insights page so the page stays composition-only; widget content comes in
// through `renderWidget`, so the grid knows nothing about queries or menus.
// ---------------------------------------------------------------------------

export const ROW_PX = 90;
const MIN_W = 3;
const MIN_H = 2;
const MAX_H = 8;

/** Ordered layout entry — order in the array IS the board order; x/y are
 *  derived at save time so the stored shape stays react-grid-layout-ish. */
export interface LayoutEntry {
  i: string;
  w: number;
  h: number;
}

function toOrderedLayout(dashboard: InsightsDashboard): LayoutEntry[] {
  const byId = new Map((dashboard.layout ?? []).map((l) => [l.i, l] as const));
  const known = dashboard.widgets
    .map((w) => {
      const item = byId.get(String(w.id));
      return { id: String(w.id), item };
    })
    .sort((a, b) => {
      const ay = a.item ? a.item.y * 100 + a.item.x : Number.MAX_SAFE_INTEGER;
      const by = b.item ? b.item.y * 100 + b.item.x : Number.MAX_SAFE_INTEGER;
      return ay - by;
    });
  return known.map(({ id, item }) => ({
    i: id,
    w: Math.min(12, Math.max(MIN_W, item?.w ?? 6)),
    h: Math.min(MAX_H, Math.max(MIN_H, item?.h ?? 3)),
  }));
}

function toStoredLayout(entries: LayoutEntry[]): InsightsLayoutItem[] {
  // Pack row by row so x/y stay meaningful for other clients.
  const items: InsightsLayoutItem[] = [];
  let x = 0;
  let y = 0;
  for (const e of entries) {
    if (x + e.w > 12) {
      x = 0;
      y += 1;
    }
    items.push({ i: e.i, x, y, w: e.w, h: e.h });
    x += e.w;
  }
  return items;
}

export interface WidgetGridControls {
  /** Spread onto the widget's drag handle. Absent when read-only. */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Keyboard-accessible reorder, complementing pointer drag. */
  onMove: (direction: "earlier" | "later") => void;
}

export interface DashboardGridProps {
  dashboard: InsightsDashboard;
  readOnly: boolean;
  /** Called (debounced) with the packed layout whenever it changes. */
  onPersist: (layout: InsightsLayoutItem[]) => void;
  renderWidget: (widget: InsightsWidget, controls: WidgetGridControls) => ReactNode;
}

export function DashboardGrid({
  dashboard,
  readOnly,
  onPersist,
  renderWidget,
}: DashboardGridProps) {
  const { t } = useI18n();
  const [layout, setLayout] = useState<LayoutEntry[]>([]);
  const interactingRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // The target we last reordered against this drag. Reordering shuffles the
  // DOM, which makes native drag fire dragEnter again on the element now under
  // the cursor — so without this guard the list oscillates and the drop lands
  // in the wrong slot. We only reorder when the cursor enters a genuinely new
  // neighbour.
  const lastDragOverId = useRef<string | null>(null);

  useEffect(() => {
    // The local layout is authoritative mid-interaction and while a save is
    // pending — a refetch-driven sync would fight the user's drag.
    if (interactingRef.current || persistTimer.current) return;
    setLayout(toOrderedLayout(dashboard));
  }, [dashboard]);

  const persistLayout = (entries: LayoutEntry[]) => {
    if (readOnly) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      onPersist(toStoredLayout(entries));
    }, 600);
  };

  const applyLayout = (entries: LayoutEntry[]) => {
    setLayout(entries);
    persistLayout(entries);
  };

  const moveWidget = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = layout.findIndex((l) => l.i === fromId);
    const to = layout.findIndex((l) => l.i === toId);
    if (from < 0 || to < 0) return;
    const next = [...layout];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    applyLayout(next);
  };

  const moveByOffset = (id: string, offset: number) => {
    const from = layout.findIndex((l) => l.i === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= layout.length) return;
    moveWidget(id, layout[to].i);
  };

  const resizeTo = (id: string, w: number, h: number) => {
    const clampedW = Math.min(12, Math.max(MIN_W, w));
    const clampedH = Math.min(MAX_H, Math.max(MIN_H, h));
    setLayout((cur) =>
      cur.map((l) =>
        l.i === id && (l.w !== clampedW || l.h !== clampedH)
          ? { ...l, w: clampedW, h: clampedH }
          : l,
      ),
    );
  };

  const startResize = (e: React.PointerEvent, id: string) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    const entry = layout.find((l) => l.i === id);
    if (!grid || !entry) return;
    interactingRef.current = true;
    const colPx = grid.clientWidth / 12;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = entry.w;
    const startH = entry.h;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      resizeTo(
        id,
        Math.round(startW + (ev.clientX - startX) / colPx),
        Math.round(startH + (ev.clientY - startY) / ROW_PX),
      );
    };
    const finish = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", finish);
      // pointercancel fires when the browser/OS steals the gesture (touch
      // interruption, context menu, scroll). Without handling it, onUp would
      // never run and interactingRef would stay stuck true — permanently
      // freezing server→grid sync for this board.
      target.removeEventListener("pointercancel", finish);
      interactingRef.current = false;
      setLayout((cur) => {
        persistLayout(cur);
        return cur;
      });
    };
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  };

  /** Arrow keys resize by one grid unit; the handle is a focusable button. */
  const keyboardResize = (e: React.KeyboardEvent, id: string) => {
    const entry = layout.find((l) => l.i === id);
    if (!entry) return;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    resizeTo(id, entry.w + d[0], entry.h + d[1]);
    setLayout((cur) => {
      persistLayout(cur);
      return cur;
    });
  };

  return (
    <div
      ref={gridRef}
      className="grid flex-1 auto-rows-min grid-cols-12 gap-4 overflow-y-auto pb-8"
    >
      {layout.map((item) => {
        const widget = dashboard.widgets.find((w) => String(w.id) === item.i);
        if (!widget) return null;
        return (
          <div
            key={item.i}
            className={cn(
              "group relative col-span-12",
              dragId === item.i && "opacity-60",
            )}
            style={{
              gridColumn: `span ${item.w} / span ${item.w}`,
              height: `${item.h * ROW_PX}px`,
            }}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDragEnter={() => {
              // Reorder once per newly-entered neighbour. Re-entering the same
              // target (which happens as the DOM reshuffles under the cursor)
              // is ignored, so the list can't oscillate mid-drag.
              if (!dragId || item.i === dragId) return;
              if (lastDragOverId.current === item.i) return;
              lastDragOverId.current = item.i;
              moveWidget(dragId, item.i);
            }}
            onDrop={(e) => e.preventDefault()}
          >
            {renderWidget(widget, {
              onMove: (direction) =>
                moveByOffset(item.i, direction === "earlier" ? -1 : 1),
              dragHandleProps: readOnly
                ? undefined
                : {
                    draggable: true,
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      interactingRef.current = true;
                      lastDragOverId.current = item.i;
                      setDragId(item.i);
                    },
                    onDragEnd: () => {
                      interactingRef.current = false;
                      lastDragOverId.current = null;
                      setDragId(null);
                    },
                  },
            })}
            {!readOnly && (
              <button
                type="button"
                className="absolute bottom-1 end-1 hidden h-4 w-4 cursor-se-resize touch-none rounded-sm border-b-2 border-e-2 border-slate-300 focus-visible:block focus-visible:outline-2 group-hover:block"
                title={t("insights.widget.resizeTitle")}
                aria-label={t("insights.widget.resizeAria", { name: widget.name })}
                onPointerDown={(e) => startResize(e, item.i)}
                onKeyDown={(e) => keyboardResize(e, item.i)}
                data-testid={`resize-${widget.id}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
