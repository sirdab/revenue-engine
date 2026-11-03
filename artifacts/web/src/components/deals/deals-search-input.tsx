import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";

// Free-text search across deal title, contact, and organization (q param).
// Kept as local state debounced into the URL (rather than binding directly to
// state.q) so typing feels instant while requests stay debounced.
export function DealsSearchInput({
  state,
  update,
}: {
  state: DealsUrlState;
  update: (
    partial: Partial<DealsUrlState>,
    opts?: { replace?: boolean },
  ) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(state.q ?? "");
  const debounced = useDebouncedValue(text, 300);
  // Distinguishes "state.q changed because we just pushed it" (skip resync)
  // from "state.q changed externally — back/forward" (do resync), so a
  // self-push never clobbers keystrokes typed in the interim.
  const lastPushed = useRef(state.q ?? "");

  useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed === (state.q ?? "")) return;
    lastPushed.current = trimmed;
    // Replace, not push: consecutive keystroke-driven refinements of one
    // search collapse into a single history entry instead of one per pause.
    update({ q: trimmed || undefined }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    const current = state.q ?? "";
    if (current === lastPushed.current) return;
    lastPushed.current = current;
    setText(current);
  }, [state.q]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("deals.searchPlaceholder")}
        className="h-8 w-[200px] ps-7 text-xs"
      />
    </div>
  );
}
