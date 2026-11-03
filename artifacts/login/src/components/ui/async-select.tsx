import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { useI18n } from "@/lib/i18n/i18n";
export interface AsyncOption {
  value: string;
  label: string;
}

/**
 * A select whose options are fetched on demand (debounced) — for picking from
 * large sets (e.g. tens of thousands of organizations) without ever loading the
 * whole list. `loadOptions` should be memoized by the caller.
 */
export function AsyncSelect({
  value,
  valueLabel,
  onChange,
  loadOptions,
  placeholder: placeholderProp,
  emptyLabel: emptyLabelProp,
  allValue,
  allLabel,
  onCreate,
  creating = false,
  createLabel: createLabelProp,
  createLabelEmpty: createLabelEmptyProp,
  minChars = 0,
  searchPromptLabel: searchPromptLabelProp,
  inModal = false,
  triggerClassName,
  contentClassName,
}: {
  value: string | null;
  valueLabel?: string | null;
  onChange: (value: string | null, label: string | null) => void;
  loadOptions: (q: string) => Promise<AsyncOption[]>;
  placeholder?: string;
  emptyLabel?: string;
  /** Optional sentinel for an "All / None" choice rendered at the top. */
  allValue?: string;
  allLabel?: string;
  /**
   * When set, pin a persistent "Create …" row to the top of the list. It reads
   * `createLabelEmpty` with no query (or when the query exactly matches an
   * existing option) and `createLabel(query)` once the user has typed something
   * new. The callback receives the trimmed query, which may be an empty string.
   */
  onCreate?: (label: string) => void;
  creating?: boolean;
  createLabel?: (q: string) => string;
  createLabelEmpty?: string;
  /**
   * Require at least this many typed characters before loading options. `0`
   * (default) keeps the load-on-open behavior; `1`+ makes the picker
   * search-only — it shows `searchPromptLabel` and fetches nothing until the
   * user types.
   */
  minChars?: number;
  searchPromptLabel?: string;
  /**
   * Set when this picker renders inside a modal `Dialog` so its result list can
   * scroll (renders the popover inline rather than portalled — see
   * `PopoverContent`'s `disablePortal`).
   */
  inModal?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const { t } = useI18n();
  // Defaults resolve through t() rather than in the parameter list, which
  // is evaluated before any hook can run.
  const placeholder = placeholderProp ?? t("common.search");
  const emptyLabel = emptyLabelProp ?? t("common.noResults");
  const createLabel =
    createLabelProp ?? ((q: string) => t("common.createQuoted", { query: q }));
  const createLabelEmpty = createLabelEmptyProp ?? t("common.createNew");
  const searchPromptLabel = searchPromptLabelProp ?? t("common.typeToSearch");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, 250);
  const [options, setOptions] = useState<AsyncOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const belowMinChars = debounced.trim().length < minChars;

  useEffect(() => {
    if (!open) return;
    // Search-only mode: below the threshold, load nothing and show the prompt.
    if (belowMinChars) {
      setOptions([]);
      setLoading(false);
      setErrored(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    loadOptions(debounced)
      .then((o) => {
        if (!cancelled) setOptions(o);
      })
      .catch(() => {
        // Distinguish a failed load from a genuine empty result — otherwise a
        // transient search error reads as "no matches" and can push the user to
        // create a duplicate via the inline "Create" row.
        if (!cancelled) {
          setOptions([]);
          setErrored(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open, loadOptions, belowMinChars]);

  const isAll = allValue !== undefined && (value == null || value === allValue);
  const display = isAll ? (allLabel ?? placeholder) : valueLabel || value || placeholder;

  const trimmed = q.trim();
  // The create row is persistent whenever `onCreate` is provided — visible on
  // open before any typing. Once the user types text that isn't already an
  // exact option, it upgrades to the specific "Create 'X'" label.
  const hasExactMatch = options.some(
    (o) => o.label.toLowerCase() === trimmed.toLowerCase(),
  );
  const showCreate = !!onCreate;
  const createRowLabel =
    trimmed !== "" && !hasExactMatch ? createLabel(trimmed) : createLabelEmpty;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between font-normal",
            isAll && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">{display}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[260px] p-0", contentClassName)}
        align="start"
        disablePortal={inModal}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={q} onValueChange={setQ} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            ) : belowMinChars ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {searchPromptLabel}
              </div>
            ) : errored ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t("common.loadResultsFailed")}
              </div>
            ) : (
              <CommandEmpty>{emptyLabel}</CommandEmpty>
            )}
            {showCreate && (
              <>
                <CommandGroup>
                  <CommandItem
                    value="__create__"
                    onSelect={() => {
                      onCreate?.(trimmed);
                      setQ("");
                      setOpen(false);
                    }}
                    className="text-teal-700"
                  >
                    {creating ? (
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="me-2 h-4 w-4" />
                    )}
                    <span className="truncate">{createRowLabel}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup>
              {allValue !== undefined && (
                <CommandItem
                  value={allValue}
                  onSelect={() => {
                    onChange(allValue, null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      value === allValue || value == null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onChange(o.value, o.label);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
