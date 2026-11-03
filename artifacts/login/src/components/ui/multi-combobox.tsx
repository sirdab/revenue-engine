import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
// Multi-select sibling of <Combobox>. Same Command/Popover primitives and the
// same render cap, but selection is additive and the popover stays open.
//
// Built for `set` deal fields with a long vocabulary: a chip-row editor that
// renders EVERY option at once is fine for five options and unusable past a
// dozen.

const RENDER_CAP = 100;

export interface MultiComboboxProps {
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  inModal?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  renderCap?: number;
}

export function MultiCombobox({
  options,
  values,
  onChange,
  placeholder: placeholderProp,
  emptyLabel = "—",
  inModal = false,
  disabled = false,
  className,
  triggerClassName,
  renderCap = RENDER_CAP,
}: MultiComboboxProps) {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t("common.search");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(values), [values]);

  // A stored value with no matching option (an option removed since, or a
  // spelling the webhook could not canonicalise) still has to be visible and
  // removable — otherwise it is invisible data the user cannot clear.
  const orphans = useMemo(
    () => values.filter((v) => !options.includes(v)),
    [values, options],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.toLowerCase().includes(q))
      : options;
    return { shown: matches.slice(0, renderCap), total: matches.length };
  }, [options, search, renderCap]);

  const toggle = (option: string) => {
    onChange(
      selected.has(option)
        ? values.filter((v) => v !== option)
        : [...values, option],
    );
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-auto min-h-8 justify-between font-normal",
              values.length === 0 && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate text-start">
              {values.length === 0
                ? emptyLabel
                : values.length === 1
                  ? values[0]
                  : `${values.length} selected`}
            </span>
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[280px] p-0"
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
                {filtered.shown.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => toggle(opt)}
                  >
                    <Check
                      className={cn(
                        "me-2 h-4 w-4",
                        selected.has(opt) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {filtered.total > filtered.shown.length && (
                <div className="px-2 py-1.5 text-center text-xs text-muted-foreground">
                  {t("common.showingOf", { shown: filtered.shown.length, total: filtered.total })}
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <span
              key={v}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs",
                orphans.includes(v)
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-teal-300 bg-teal-50 text-teal-700",
              )}
              title={orphans.includes(v) ? t("common.notInOptionList") : undefined}
            >
              <span className="truncate">{v}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="opacity-60 transition-opacity hover:opacity-100"
                aria-label={t("common.removeValue", { value: v })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
