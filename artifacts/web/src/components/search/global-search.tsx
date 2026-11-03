import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useSearch,
  getSearchQueryKey,
  type SearchResultItem,
} from "@workspace/api-client-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Briefcase,
  CornerDownLeft,
  Loader2,
  SearchX,
  TriangleAlert,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useRecentlyViewed,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import {
  RECORD_ICON,
  Highlight,
  relativeTime,
  countLabel,
  SEARCH_SCOPES,
  scopeLabel,
  scopeToTypesParam,
  type SearchScope,
} from "@/components/search/search-shared";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

const RECENTLY_VIEWED_MODULE_LABEL: Record<string, MessageKey> = {
  deal: "common.deals",
  organization: "contacts.organizations",
  person: "common.contacts",
};

function ResultRow({
  item,
  term,
  onSelect,
}: {
  item: SearchResultItem;
  term: string;
  onSelect: (href: string) => void;
}) {
  const Icon = RECORD_ICON[item.recordType] ?? Briefcase;
  const time = relativeTime(item.timestamp);
  return (
    <CommandItem
      value={item.key}
      onSelect={() => onSelect(item.href)}
      className="flex items-start gap-3 !py-2.5"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span dir="auto" className="truncate font-medium text-slate-900">
            {item.title}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {item.module}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500">
          <span className="font-medium text-slate-400">{item.field}: </span>
          <Highlight text={item.matchValue} term={term} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-400">
          {item.relatedName && (
            <span className="truncate">{item.relatedName}</span>
          )}
          {item.relatedName && (item.ownerName || time) && <span>·</span>}
          {item.ownerName && <span className="truncate">{item.ownerName}</span>}
          {item.ownerName && time && <span>·</span>}
          {time && <span className="shrink-0">{time}</span>}
        </div>
      </div>
    </CommandItem>
  );
}
export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const debounced = useDebounce(input.trim(), 180);
  const enabled = debounced.length >= 1;
  const recentlyViewed = useRecentlyViewed();
  const { isLoading: preferencesLoading } = useUserPreferences();
  const showRecentlyViewed = !enabled && !preferencesLoading && recentlyViewed.length > 0;
  const typesParam = scopeToTypesParam(scope);

  // Clear the box each time the palette is closed so it always opens fresh.
  useEffect(() => {
    if (!open) {
      setInput("");
      setScope("all");
    }
  }, [open]);

  const { data, isFetching, isError } = useSearch(
    { q: debounced, types: typesParam },
    {
      query: {
        enabled,
        queryKey: getSearchQueryKey({ q: debounced, types: typesParam }),
        placeholderData: (prev) => prev,
      },
    },
  );

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const total = data?.total ?? 0;
  // A failed request must read as an error, not as "no results".
  const showError = enabled && isError && total === 0;
  const showEmpty = enabled && !isFetching && !isError && total === 0;

  // cmdk only highlights the first item when the search text changes, and here
  // results land a debounce and a fetch later, so nothing was highlighted and
  // Enter did nothing. Re-point the highlight at the top hit whenever the
  // result set changes, so type-then-Enter opens it.
  const firstKey = enabled
    ? groups[0]?.results[0]?.key
    : showRecentlyViewed
      ? recentlyViewed[0]?.href
      : undefined;
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected(firstKey ?? "");
  }, [firstKey, data]);

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  const seeAll = () => {
    if (!debounced) return;
    const qs = new URLSearchParams({ q: debounced });
    if (typesParam) qs.set("types", typesParam);
    go(`/search?${qs.toString()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 shadow-2xl sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("common.search")}</DialogTitle>
        <Command
          shouldFilter={false}
          value={selected}
          onValueChange={setSelected}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400"
          onKeyDown={(e) => {
            // Enter with no selectable results still lets you jump to the full
            // results page rather than doing nothing.
            if (e.key === "Enter" && total === 0 && enabled) {
              e.preventDefault();
              seeAll();
            }
          }}
        >
          <div className="border-b border-slate-100 p-3">
            <div className="flex items-center gap-2">
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as SearchScope)}
              >
                <SelectTrigger
                  className="h-9 w-[130px] text-sm"
                  aria-label={t("search.scope")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEARCH_SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CommandInput
                value={input}
                onValueChange={setInput}
                placeholder={t("search.placeholder")}
                className="h-9 flex-1"
              />
            </div>
          </div>
          <CommandList className="max-h-[60vh]">
            {!enabled && !preferencesLoading && recentlyViewed.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {t("search.hint")}
              </div>
            )}

            {showRecentlyViewed && (
              <CommandGroup heading={t("home.recent.title")}>
                {recentlyViewed.map((item) => {
                  const Icon = RECORD_ICON[item.type] ?? Briefcase;
                  const time = relativeTime(item.viewedAt);
                  return (
                    <CommandItem
                      key={item.href}
                      value={item.href}
                      onSelect={() => go(item.href)}
                      className="flex items-start gap-3 !py-2.5"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            dir="auto"
                            className="truncate font-medium text-slate-900"
                          >
                            {item.title}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            {RECENTLY_VIEWED_MODULE_LABEL[item.type] ? t(RECENTLY_VIEWED_MODULE_LABEL[item.type]) : item.type}
                          </span>
                        </div>
                        {time && (
                          <div className="mt-0.5 truncate text-[11px] text-slate-400">
                            {time}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {showError && (
              <div className="px-4 py-10 text-center">
                <TriangleAlert className="mx-auto mb-2 h-6 w-6 text-amber-400" />
                <div className="text-sm font-medium text-slate-600">
                  {t("search.unavailable")}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {t("search.keepTyping")}
                </div>
              </div>
            )}

            {enabled && !isError && isFetching && total === 0 && (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("search.searching")}
              </div>
            )}

            {showEmpty && (
              <CommandEmpty className="px-4 py-10 text-center">
                <SearchX className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                <div className="text-sm font-medium text-slate-600">
                  {t("search.noResultsQuoted", { query: debounced })}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {t("search.tryDifferent")}
                </div>
              </CommandEmpty>
            )}

            {enabled &&
              groups.map((group) => (
              <CommandGroup
                key={`${group.recordType}-${group.label}`}
                heading={`${scopeLabel(t, group.recordType, group.label)} · ${countLabel(group.results.length, group.hasMore)}`}
              >
                {group.results.map((item) => (
                  <ResultRow
                    key={item.key}
                    item={item}
                    term={debounced}
                    onSelect={go}
                  />
                ))}
              </CommandGroup>
              ))}
          </CommandList>

          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1">
                  ↑↓
                </kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" />
                open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1">
                  esc
                </kbd>
                close
              </span>
            </div>
            {enabled && total > 0 && (
              <button
                type="button"
                onClick={seeAll}
                className="font-medium text-teal-600 hover:text-teal-700"
              >
                {t("search.viewAll")}
              </button>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
