// Inline-editable cells shared by the deals grid and the deal detail page.
//
// The text/money/number/textarea editors render a read-style control that turns
// editable on focus/click and commits on blur (Enter commits, Escape reverts).
// EditableDate is the exception: it is a popover DatePicker that commits on
// select and cancels on Escape/click-away (there is no blur to commit on — see
// its own note below). None of them hold their own source of truth across
// refetches — the committed value flows back in via props.
//
// Escape handling (blur-committing editors only): `.blur()` dispatches the blur
// event synchronously, so the onBlur closure still sees the pre-revert draft — a
// state reset alone would commit the very edit the user tried to discard. Those
// editors therefore mark cancellation in a ref that the blur handler checks first.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { Money } from "@/components/shared/money";
import { linkifyText } from "@/components/shared/linkify";
import type { Deal, Stage } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

export function EditableText({
  value,
  onCommit,
  placeholder = "—",
  className,
  allowClear = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  /** Permit committing an empty string to clear optional columns. Off by
   *  default so required fields (e.g. the deal title) can't be blanked. */
  allowClear?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <input
      dir="auto"
      value={draft}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(value);
          return;
        }
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) onCommit(trimmed);
        else if (!trimmed && allowClear && value) onCommit("");
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "w-full truncate rounded-sm bg-transparent px-1 py-0.5 font-medium text-foreground outline-none focus:bg-card focus:ring-1 focus:ring-ring",
        className,
      )}
    />
  );
}

export function EditableMoney({
  value,
  currency,
  onCommit,
  onClear,
  className,
}: {
  value: number;
  currency: string;
  onCommit: (next: number) => void;
  /** When given, blanking the field clears it (optional custom fields).
   *  Without it, an empty value reverts — the deal value can't be blanked. */
  onClear?: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(String(value));
          setEditing(true);
        }}
        className={cn(
          "rounded-sm px-1 py-0.5 font-medium tabular-nums text-foreground hover:bg-gray-alpha-100",
          className,
        )}
      >
        <Money value={value} currency={currency} />
      </button>
    );
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      autoFocus
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        // Empty, unparsable, or negative input reverts — blanking the field
        // must never silently commit a zero value. Empty clears instead when
        // the caller allows it.
        const n = Number(draft);
        if (draft.trim() === "") onClear?.();
        else if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          setEditing(false);
        }
      }}
      className={cn(
        "w-full rounded-sm bg-card px-1 py-0.5 tabular-nums outline-none ring-1 ring-ring",
        className,
      )}
    />
  );
}

// Date editor ("YYYY-MM-DD", empty commits null). Now a popover DatePicker:
// it commits when a day is picked and closes without committing on
// Escape/click-away — there is no blur to commit on (KTD5), so the old
// focus/blur/cancel machinery is gone. `norm` still slices the incoming value
// to 10 chars (it may arrive as a full ISO timestamp). Selecting the day that
// is already set is a no-op, so no redundant PATCH/audit entry is written.
export function EditableDate({
  value,
  onCommit,
  className,
}: {
  value: string | null | undefined;
  onCommit: (next: string | null) => void;
  className?: string;
}) {
  const norm = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

  return (
    // Wrapper stops the trigger click from bubbling to the surrounding card/row
    // (which would open the deal). Day clicks happen in the portalled popover,
    // outside this subtree, so they don't bubble here.
    <div onClick={(e) => e.stopPropagation()}>
      <DatePicker
        value={norm(value)}
        onChange={(next) => {
          if (next !== norm(value)) onCommit(next || null);
        }}
        className={cn(
          "h-auto min-h-0 gap-1.5 border-transparent bg-transparent px-1 py-0.5 text-body text-foreground shadow-none hover:bg-gray-alpha-100 focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      />
    </div>
  );
}

export function EditableStage({
  deal,
  stages,
  onCommit,
}: {
  deal: Deal;
  stages: Stage[];
  onCommit: (stageId: number) => void;
}) {
  const options = useMemo(
    () =>
      stages
        .filter((s) => s.pipelineId === deal.pipelineId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [stages, deal.pipelineId],
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select
        value={deal.stageId.toString()}
        onValueChange={(v) => {
          const next = Number(v);
          if (next !== deal.stageId) onCommit(next);
        }}
      >
        <SelectTrigger className="h-7 border-transparent bg-transparent px-1 text-body shadow-none hover:bg-gray-alpha-100 focus:ring-1 focus:ring-ring">
          <SelectValue>{deal.stageName ?? "—"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s.id} value={s.id.toString()}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Multi-line text that commits on blur. Empty string commits as null so optional
// columns clear cleanly.
//
// Unfocused, it renders a read view with URLs turned into real links instead
// of the raw textarea (see linkify.tsx) — clicking a link opens it without
// entering edit mode (the link stops the click from bubbling to the div
// below); clicking anywhere else switches to the live textarea, matching the
// other editors' click-to-edit behavior.
const EDITABLE_TEXTAREA_CLASSNAME =
  "w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-body text-foreground outline-none hover:border-border focus:border-brand-500 focus:bg-card focus:ring-1 focus:ring-ring";

export function EditableTextarea({
  value,
  onCommit,
  placeholder: placeholderProp,
  rows = 3,
}: {
  value: string | null | undefined;
  onCommit: (next: string | null) => void;
  placeholder?: string;
  rows?: number;
}) {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t("deals.inline.addDetails");
  const initial = value ?? "";
  const [draft, setDraft] = useState(initial);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value ?? "");
  }, [value, focused]);

  if (!focused) {
    return (
      <div
        dir="auto"
        tabIndex={0}
        onClick={() => setFocused(true)}
        onFocus={() => setFocused(true)}
        // Same line-height/padding math as the rows-sized textarea below, so
        // short values don't collapse the field and cause a jump on focus.
        style={{ minHeight: `${rows * 1.25 + 0.75}rem` }}
        className={cn(
          EDITABLE_TEXTAREA_CLASSNAME,
          "cursor-text whitespace-pre-wrap break-words",
          !draft && "text-subtle",
        )}
      >
        {draft ? linkifyText(draft) : placeholder}
      </div>
    );
  }

  return (
    <textarea
      dir="auto"
      rows={rows}
      value={draft}
      placeholder={placeholder}
      autoFocus
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(value ?? "");
          return;
        }
        const trimmed = draft.trim();
        const next = trimmed === "" ? null : trimmed;
        if (next !== (value ?? null)) onCommit(next);
        else setDraft(value ?? "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={EDITABLE_TEXTAREA_CLASSNAME}
    />
  );
}

// Numeric editor. Empty commits as null; non-finite input is ignored.
export function EditableNumber({
  value,
  onCommit,
  placeholder = "—",
  suffix,
  integer = false,
}: {
  value: number | null | undefined;
  onCommit: (next: number | null) => void;
  placeholder?: string;
  suffix?: string;
  integer?: boolean;
}) {
  const initial = value == null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused) setDraft(value == null ? "" : String(value));
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value == null ? "" : String(value));
      return;
    }
    const t = draft.trim();
    if (t === "") {
      if (value != null) onCommit(null);
      return;
    }
    const n = integer ? parseInt(t, 10) : Number(t);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(value == null ? "" : String(value));
  };

  return (
    <div className="flex items-baseline gap-1">
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        value={draft}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded-sm bg-transparent px-1 py-0.5 font-medium tabular-nums text-foreground outline-none hover:bg-gray-alpha-100 focus:bg-card focus:ring-1 focus:ring-ring"
      />
      {suffix && draft !== "" && (
        <span className="shrink-0 text-caption text-subtle">{suffix}</span>
      )}
    </div>
  );
}

// Generic single-select that commits on change. `null` represents the cleared
// state and is rendered via the sentinel "__none__".
const NONE = "__none__";

export function EditableSelect({
  value,
  options,
  onCommit,
  onOpenChange,
  currentLabel,
  placeholder = "—",
  noneLabel: noneLabelProp,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onCommit: (next: string | null) => void;
  onOpenChange?: (open: boolean) => void;
  // Shown on the trigger for the selected value before options have loaded
  // (the options list may be fetched lazily on first open).
  currentLabel?: string | null;
  placeholder?: string;
  noneLabel?: string;
}) {
  // Ensure the current value is always renderable on the trigger even if the
  // full options list hasn't been fetched yet.
  const { t } = useI18n();
  const noneLabel = noneLabelProp ?? t("deals.inline.none");
  const merged =
    value != null && currentLabel && !options.some((o) => o.value === value)
      ? [{ value, label: currentLabel }, ...options]
      : options;
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onCommit(v === NONE ? null : v)}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger className="h-8 border-transparent bg-transparent px-1 text-body shadow-none hover:bg-gray-alpha-100 focus:ring-1 focus:ring-ring">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {merged.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
