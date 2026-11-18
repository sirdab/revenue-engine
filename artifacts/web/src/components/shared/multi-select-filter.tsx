import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

export interface MultiSelectFilterItem {
  value: string;
  label: string;
  /** Optional section heading — items sharing a group render under it
   *  (folder/files style, e.g. stages grouped by pipeline). */
  group?: string;
}

// The app's standard multi-select filter control (same recipe as the shared
// ColumnPicker): a trigger button with a selection-count badge opening a
// searchable, scroll-capped checkbox list. Toggling keeps the popover open;
// long lists scroll instead of growing past the viewport, and the popover
// never exceeds the screen width on mobile.
export function MultiSelectFilter({
  label,
  icon,
  items,
  selected,
  onChange,
  searchPlaceholder: searchPlaceholderProp,
  emptyLabel: emptyLabelProp,
  align = "start",
  testId,
}: {
  /** Trigger label, e.g. "Owner". */
  label: string;
  icon?: ReactNode;
  items: MultiSelectFilterItem[];
  /** Selected item values. */
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyLabel?: string;
  align?: "start" | "center" | "end";
  testId?: string;
}) {
  const { t } = useI18n();
  const searchPlaceholder = searchPlaceholderProp ?? t("common.search");
  const emptyLabel = emptyLabelProp ?? t("common.noMatches");
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, MultiSelectFilterItem[]>();
    for (const item of items) {
      const key = item.group ?? "";
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [items]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (value: string) =>
    onChange(
      selectedSet.has(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn("gap-1.5", selected.length > 0 && "border-btn-border-hover text-foreground")}
          data-testid={testId}
        >
          {icon}
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-caption text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-subtle" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 max-w-[92vw] p-0">
        <Command
          // cmdk values are the unique item values (two owners can share a
          // display name); search matches the human label via `keywords`.
          filter={(_value, search, keywords) =>
            (keywords ?? [])
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())
              ? 1
              : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[min(50vh,320px)]">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {grouped.map(([group, groupItems]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {groupItems.map((item) => {
                  const on = selectedSet.has(item.value);
                  return (
                    <CommandItem
                      key={item.value}
                      value={item.value}
                      keywords={[item.label]}
                      onSelect={() => toggle(item.value)}
                      className="cursor-pointer"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span dir="auto" className="truncate">
                        {item.label}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t border-border p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-caption text-muted-foreground"
                onClick={() => onChange([])}
              >
                {t("filter.clearCount", { count: selected.length })}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
