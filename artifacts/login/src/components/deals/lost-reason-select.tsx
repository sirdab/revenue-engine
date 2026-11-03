import { useState } from "react";
import { Check, ChevronsUpDown, PenLine } from "lucide-react";
import {
  useListLostReasons,
  getListLostReasonsQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
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
import { useI18n } from "@/lib/i18n/i18n";

// Searchable lost-reason picker: the admin-managed list first (clean
// reporting), with a free-text escape hatch for genuinely one-off reasons.
// Custom strings surface in Settings → Labels as "found on deals" so admins
// can promote recurring ones into the managed list.
export function LostReasonSelect({
  value,
  onChange,
  inModal,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Render the popover in place instead of a portal (see `PopoverContent`'s
   *  `disablePortal`). Pass when hosted inside a Dialog so the popover stays
   *  within the dialog's scroll-lock allowlist. */
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: reasons = [] } = useListLostReasons({
    query: { queryKey: getListLostReasonsQueryKey(), staleTime: 60_000 },
  });

  const trimmed = query.trim();
  const filtered = trimmed
    ? reasons.filter((r) =>
        r.name.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : reasons;
  const isCustom =
    trimmed !== "" &&
    !reasons.some((r) => r.name.toLowerCase() === trimmed.toLowerCase());

  const pick = (reason: string) => {
    onChange(reason);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-border bg-card px-3 text-body shadow-card transition-colors hover:border-input focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value ? "text-foreground" : "text-subtle",
          )}
        >
          <span className="truncate">{value || t("reasons.select")}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        disablePortal={inModal}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("reasons.search")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-56">
            {!isCustom && (
              <CommandEmpty>
                {reasons.length === 0
                  ? t("reasons.noReasons")
                  : t("reasons.noMatch")}
              </CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((r) => (
                <CommandItem
                  key={r.id}
                  value={r.name}
                  onSelect={() => pick(r.name)}
                >
                  <Check
                    className={cn(
                      "me-2 h-4 w-4",
                      value.toLowerCase() === r.name.toLowerCase()
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <span className="truncate">{r.name}</span>
                </CommandItem>
              ))}
              {isCustom && (
                <CommandItem
                  value={`__custom__${trimmed}`}
                  onSelect={() => pick(trimmed)}
                  className="text-brand"
                >
                  <PenLine className="me-2 h-4 w-4" />
                  <span className="truncate">{t("common.useQuoted", { value: trimmed })}</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
