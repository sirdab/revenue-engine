import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FIELD_HEIGHT,
  FIELD_RADIUS,
  FIELD_TRIGGER,
} from "@sirdab/one/components/field-chrome";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useI18n } from "@/lib/i18n/i18n";
// Cap on how many options are rendered at once so very large lists (thousands
// of organizations) stay responsive. The user narrows with the search box.
const RENDER_CAP = 100;

/** A {value,label} option — use `items` for id-keyed lists (pipelines, owners). */
export interface ComboboxItem {
  value: string;
  label: string;
  /** Optional section heading — items sharing a group render under it
   *  (folder/files style, e.g. stages grouped by pipeline). */
  group?: string;
}

export interface ComboboxProps {
  /** String options (value === label). Use this OR `items`. */
  options?: string[];
  /** Labelled options for id-keyed lists. Takes precedence over `options`. */
  items?: ComboboxItem[];
  value: string;
  onChange: (value: string) => void;
  /** Sentinel value representing "no selection" (e.g. "__all__"). Omit both
   *  to drop the "All" row entirely (pure picker — e.g. a required field). */
  allValue?: string;
  allLabel?: string;
  placeholder?: string;
  /** Maps a string option to its display label (used with `options`). */
  renderLabel?: (value: string) => string;
  /**
   * Trigger label when `value` is set but absent from the list (e.g. a deal
   * owner who has since been deactivated and no longer appears in the
   * active-only options). Without it the raw value string would show.
   */
  fallbackLabel?: string;
  /** Render the popover in place instead of a portal (see
   *  `PopoverContent`'s `disablePortal`). Pass when hosted inside a Dialog so
   *  the popover stays within the dialog's scroll-lock allowlist. */
  inModal?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Max options rendered before "type to narrow…" (default 100 — sized for
   *  huge lists like organizations). Raise for bounded lists that should always
   *  show in full, e.g. all stages grouped by pipeline. */
  renderCap?: number;
}

export function Combobox({
  options,
  items,
  value,
  onChange,
  allValue,
  allLabel,
  placeholder: placeholderProp,
  renderLabel = (v) => v,
  fallbackLabel,
  inModal = false,
  disabled = false,
  className,
  triggerClassName,
  renderCap = RENDER_CAP,
}: ComboboxProps) {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t("common.search");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Normalise either input into {value,label} entries so search + display
  // always work on the label the user actually sees.
  const entries = useMemo<ComboboxItem[]>(
    () => items ?? (options ?? []).map((o) => ({ value: o, label: renderLabel(o) })),
    [items, options, renderLabel],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q
      ? entries.filter((e) => e.label.toLowerCase().includes(q))
      : entries;
    return { shown: matches.slice(0, renderCap), total: matches.length };
  }, [entries, search, renderCap]);

  const selected = entries.find((e) => e.value === value)?.label;
  const isUnset = (allValue !== undefined && value === allValue) || value === "";
  const label =
    allValue !== undefined && value === allValue
      ? allLabel
      : (selected ??
        (value !== "" ? (fallbackLabel ?? renderLabel(value)) : placeholder));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            FIELD_TRIGGER, FIELD_HEIGHT.md, FIELD_RADIUS.md, "px-3",
            isUnset && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[240px] p-0", className)}
        align="start"
        disablePortal={inModal}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("common.noResults")}</CommandEmpty>
            <CommandGroup>
              {allValue !== undefined && (
                <CommandItem
                  value={allValue}
                  onSelect={() => {
                    onChange(allValue);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      value === allValue ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {filtered.shown
                .filter((opt) => !opt.group)
                .map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "me-2 h-4 w-4",
                        value === opt.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
            {/* Grouped items — one section per group, in first-seen order. */}
            {[...new Map(
              filtered.shown
                .filter((opt) => opt.group)
                .map((opt) => [opt.group as string, true]),
            ).keys()].map((g) => (
              <CommandGroup key={g} heading={g}>
                {filtered.shown
                  .filter((opt) => opt.group === g)
                  .map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => {
                        onChange(opt.value);
                        setSearch("");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "me-2 h-4 w-4",
                          value === opt.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
            {filtered.total > filtered.shown.length && (
              <div className="px-2 py-1.5 text-center text-caption text-muted-foreground">
                {t("common.showingOf", { shown: filtered.shown.length, total: filtered.total })}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
