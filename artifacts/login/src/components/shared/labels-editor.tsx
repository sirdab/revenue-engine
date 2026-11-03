import { useMemo, useState } from "react";
import { Tag, X, Plus, Check } from "lucide-react";
import {
  useListLabels,
  getListLabelsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  labelColorClasses,
  buildLabelColorMap,
} from "@/lib/label-colors";
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

export type LabelEntity = "deal" | "person" | "organization";

// Compact read-only chips for table cells: first few labels colored from the
// registry, the rest collapsed into a "+n" pill (full list in the tooltip).
export function LabelChips({
  entity,
  labels,
  max = 2,
}: {
  entity: LabelEntity;
  labels: string[] | null | undefined;
  max?: number;
}) {
  const { data: options = [] } = useListLabels(
    { entity },
    {
      query: {
        queryKey: getListLabelsQueryKey({ entity }),
        staleTime: 5 * 60_000,
      },
    },
  );
  const colorOf = useMemo(() => buildLabelColorMap(options), [options]);
  if (!labels || labels.length === 0) {
    return <span className="text-subtle">—</span>;
  }
  const shown = labels.slice(0, max);
  const extra = labels.length - shown.length;
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title={labels.join(", ")}
    >
      {shown.map((label) => (
        <span
          key={label}
          className={cn(
            "inline-flex max-w-[9rem] items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
            labelColorClasses(colorOf.get(label.toLowerCase())).chip,
          )}
        >
          {label}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full border border-border bg-surface-whisper px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </span>
  );
}

// Pipedrive-style label picker, shared by deals, people and organizations.
// Options come from the label registry (admin-curated colors) plus any label
// already in use; picking reuses the canonical spelling, and a "Create" row
// covers genuinely new labels (they appear in Settings → Labels as
// "unregistered" until an admin adopts them). Commits the full next array so
// the parent can PATCH `labels`.
export function LabelsEditor({
  entity,
  labels,
  onChange,
  inModal,
}: {
  entity: LabelEntity;
  labels: string[];
  onChange: (next: string[]) => void;
  /** Render the popover in place instead of a portal (see `PopoverContent`'s
   *  `disablePortal`). Pass when hosted inside a Dialog so the popover stays
   *  within the dialog's scroll-lock allowlist. */
  inModal?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: options = [] } = useListLabels(
    { entity },
    {
      query: {
        queryKey: getListLabelsQueryKey({ entity }),
        staleTime: 5 * 60_000,
      },
    },
  );

  const colorOf = useMemo(() => buildLabelColorMap(options), [options]);
  const isSelected = (l: string) =>
    labels.some((s) => s.toLowerCase() === l.toLowerCase());

  // Offer every known label plus any already on this record, deduped + sorted.
  const names = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of [...options.map((o) => o.name), ...labels]) {
      const k = l.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(l);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [options, labels]);

  const trimmed = query.trim();
  const filtered = trimmed
    ? names.filter((o) => o.toLowerCase().includes(trimmed.toLowerCase()))
    : names;
  const canCreate =
    trimmed !== "" &&
    !names.some((o) => o.toLowerCase() === trimmed.toLowerCase());

  const toggle = (l: string) => {
    if (isSelected(l)) {
      onChange(labels.filter((s) => s.toLowerCase() !== l.toLowerCase()));
    } else {
      onChange([...labels, l]);
    }
  };

  const create = () => {
    onChange([...labels, trimmed]);
    setQuery("");
    // The new label becomes part of the shared set once the record is saved.
    queryClient.invalidateQueries({
      queryKey: getListLabelsQueryKey({ entity }),
    });
  };

  const remove = (l: string) => onChange(labels.filter((x) => x !== l));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => {
        const colors = labelColorClasses(colorOf.get(label.toLowerCase()));
        return (
          <span
            key={label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border py-0.5 ps-2.5 pe-1.5 text-xs font-medium",
              colors.chip,
            )}
          >
            <Tag className="h-3 w-3" />
            {label}
            <button
              type="button"
              onClick={() => remove(label)}
              aria-label={t("common.removeValue", { value: label })}
              className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-300 hover:text-brand"
          >
            <Plus className="h-3 w-3" />
            {labels.length === 0 && t("labels.add")}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-56 p-0"
          align="start"
          disablePortal={inModal}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("labels.searchOrCreate")}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {!canCreate && <CommandEmpty>{t("labels.empty")}</CommandEmpty>}
              <CommandGroup>
                {filtered.map((l) => (
                  <CommandItem key={l} value={l} onSelect={() => toggle(l)}>
                    <Check
                      className={cn(
                        "me-2 h-4 w-4",
                        isSelected(l) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span
                      className={cn(
                        "me-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                        labelColorClasses(colorOf.get(l.toLowerCase())).swatch,
                      )}
                    />
                    <span className="truncate">{l}</span>
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem
                    value={`__create__${trimmed}`}
                    onSelect={create}
                    className="text-brand"
                  >
                    <Plus className="me-2 h-4 w-4" />
                    <span className="truncate">{t("common.createQuoted", { query: trimmed })}</span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
