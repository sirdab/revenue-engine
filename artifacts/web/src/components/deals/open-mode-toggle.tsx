import { useLayoutEffect, useRef, useState } from "react";
import { Maximize2, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealOpenMode } from "@/hooks/use-user-preferences";
import { useI18n } from "@/lib/i18n/i18n";

// Width of one segment in px. Wide enough to fit "Side drawer" + its icon
// without clipping, so both segments and the sliding knob line up exactly.
const SEG = 104;
// Pixel movement past which a press counts as a drag (vs. a tap-to-select).
const DRAG_THRESHOLD = 3;
// Settle used only for tap/keyboard switches — a drag commits instantly.
const SETTLE = "transform 150ms linear";

/**
 * Segmented "how deals open" control (deals.openMode). The teal knob (same
 * green as the "+ Deal" button) tracks the cursor 1:1 while dragged and
 * commits instantly on release (no springy settle); a plain click glides.
 *
 * The knob's position is written straight to the DOM (not via React state) so
 * the drag never trails the cursor and so we can choose per-interaction
 * whether the move animates.
 */
export function OpenModeToggle({
  value,
  onChange,
}: {
  value: DealOpenMode;
  onChange: (mode: DealOpenMode) => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startX: number; startKnob: number; x: number; moved: boolean } | null>(
    null,
  );
  // Whether the next resting placement (driven by a value change) animates.
  // Drag-release sets this false (instant); tap/keyboard set it true (glide).
  const animateNext = useRef(false);
  // Which side the labels highlight while dragging; null = follow `value`.
  const [preview, setPreview] = useState<DealOpenMode | null>(null);

  const restingX = value === "drawer" ? SEG : 0;
  const activeIsDrawer = (preview ?? value) === "drawer";

  function place(x: number, animate: boolean) {
    const knob = knobRef.current;
    if (!knob) return;
    knob.style.transition = animate ? SETTLE : "none";
    knob.style.transform = `translateX(${x}px)`;
  }

  // Position the knob whenever it's resting (mount, tap, keyboard, drag-commit).
  // Runs before paint so there's no flash; skipped mid-drag (the drag owns it).
  useLayoutEffect(() => {
    if (drag.current) return;
    place(restingX, animateNext.current);
    animateNext.current = false;
  }, [restingX]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    rootRef.current?.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startKnob: restingX, x: restingX, moved: false };
    place(restingX, false); // kill any transition — knob will track 1:1
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
    d.x = Math.max(0, Math.min(SEG, d.startKnob + dx));
    place(d.x, false); // glued to the cursor, no transition
    const side: DealOpenMode = d.x > SEG / 2 ? "drawer" : "page";
    setPreview((p) => (p === side ? p : side));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setPreview(null);
    let target: DealOpenMode;
    if (d.moved) {
      // A drag: commit instantly to the nearest side — no post-release glide.
      target = d.x > SEG / 2 ? "drawer" : "page";
      animateNext.current = false;
      place(target === "drawer" ? SEG : 0, false);
    } else {
      // A tap: select the clicked side and let it glide there.
      const rect = rootRef.current!.getBoundingClientRect();
      target = e.clientX - rect.left > rect.width / 2 ? "drawer" : "page";
      animateNext.current = true;
    }
    if (target !== value) onChange(target);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "Home") {
      animateNext.current = true;
      onChange("page");
    } else if (e.key === "ArrowRight" || e.key === "End") {
      animateNext.current = true;
      onChange("drawer");
    }
  }

  const segClass =
    "pointer-events-none relative z-10 flex items-center justify-center gap-1.5 rounded-[5px] transition-colors";

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={t("deals.openMode.aria")}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
        place(restingX, false);
      }}
      onKeyDown={onKeyDown}
      style={{ width: SEG * 2 + 6 }}
      className={cn(
        "relative inline-flex h-8 shrink-0 touch-none select-none items-stretch rounded-md border border-input bg-background p-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        preview != null ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      {/* Teal knob — positioned imperatively (see place()). */}
      <span
        ref={knobRef}
        aria-hidden
        style={{ width: SEG }}
        className="pointer-events-none absolute inset-y-0.5 start-0.5 rounded-[5px] bg-teal-600 shadow-sm"
      />
      <span
        role="radio"
        aria-checked={!activeIsDrawer}
        style={{ width: SEG }}
        className={cn(segClass, !activeIsDrawer ? "font-medium text-white" : "text-slate-500")}
      >
        <Maximize2 className="h-3.5 w-3.5" /> {t("deals.openMode.fullPage")}
      </span>
      <span
        role="radio"
        aria-checked={activeIsDrawer}
        style={{ width: SEG }}
        className={cn(segClass, activeIsDrawer ? "font-medium text-white" : "text-slate-500")}
      >
        <PanelRight className="h-3.5 w-3.5" /> {t("deals.openMode.drawer")}
      </span>
    </div>
  );
}
