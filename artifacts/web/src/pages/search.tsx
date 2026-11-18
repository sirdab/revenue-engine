import React from "react";
import { Link, useLocation, useSearchParams } from "wouter";
import {
  useSearch,
  getSearchQueryKey,
  type SearchResultItem,
} from "@workspace/api-client-react";
import { Briefcase, Loader2, SearchX, TriangleAlert } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RECORD_ICON,
  Highlight,
  relativeTime,
  countLabel,
  SEARCH_SCOPES,
  scopeLabel,
  scopeToTypesParam,
  typesParamToScope,
  type SearchScope,
} from "@/components/search/search-shared";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/i18n";

function ResultCard({ item, term }: { item: SearchResultItem; term: string }) {
  const Icon = RECORD_ICON[item.recordType] ?? Briefcase;
  const time = relativeTime(item.timestamp);
  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 p-4 transition-colors hover:bg-row-surface-hover"
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span dir="auto" className="truncate font-medium text-foreground">
            {item.title}
          </span>
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-caption text-muted-foreground">
            {item.module}
          </span>
        </div>
        <div className="mt-1 truncate text-body text-muted-foreground">
          <span className="font-medium text-subtle">{item.field}: </span>
          <Highlight text={item.matchValue} term={term} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-subtle">
          {item.relatedName && (
            <span className="truncate">{item.relatedName}</span>
          )}
          {item.relatedName && (item.ownerName || time) && <span>·</span>}
          {item.ownerName && <span className="truncate">{item.ownerName}</span>}
          {item.ownerName && time && <span>·</span>}
          {time && <span className="shrink-0">{time}</span>}
        </div>
      </div>
    </Link>
  );
}

export default function SearchPage() {
  const { t, tPlural } = useI18n();
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const q = params.get("q") ?? "";
  const scope = typesParamToScope(params.get("types"));
  const typesParam = scopeToTypesParam(scope);

  const {
    data: results,
    isLoading,
    isError,
    refetch,
  } = useSearch(
    { q, types: typesParam },
    {
      query: {
        queryKey: getSearchQueryKey({ q, types: typesParam }),
        enabled: !!q,
      },
    },
  );

  if (!q)
    return (
      <div className="p-8 text-center text-muted-foreground">
        {t("search.enterQuery")}
      </div>
    );

  if (isLoading)
    return (
      <Loader2 className="m-auto mt-10 h-8 w-8 animate-spin text-subtle" />
    );

  if (isError)
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-12 text-center shadow-card">
        <TriangleAlert className="mx-auto mb-3 h-8 w-8 text-warning-glyph" />
        <div className="font-medium text-foreground">
          {t("search.unavailable")}
        </div>
        <div className="mt-1 text-body text-subtle">
          {t("search.errorBody", { query: q })}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className={cn(buttonVariants(), "mt-4")}
        >
          {t("common.tryAgain")}
        </button>
      </div>
    );

  const groups = results?.groups ?? [];
  const total = results?.total ?? 0;
  // Any capped group means the true match count exceeds what we show.
  const truncated = groups.some((g) => g.hasMore);

  const updateScope = (next: SearchScope) => {
    const nextParams = new URLSearchParams(params);
    if (next === "all") nextParams.delete("types");
    else nextParams.set("types", next);
    navigate(`/search?${nextParams.toString()}`, { replace: true });
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading-sm text-foreground">
            {t("search.resultsFor", { query: q })}
          </h1>
          <p className="mt-1 text-body-quiet text-muted-foreground">
            {t("search.acrossAll", {
              // A capped count reads "50+ matches": plural on a number that
              // is known to be more than shown, so always the "other" form.
              count: truncated
                ? tPlural("search.matches", 1000, { count: countLabel(total, truncated) })
                : tPlural("search.matches", total),
            })}
          </p>
        </div>
        <Select value={scope} onValueChange={(v) => updateScope(v as SearchScope)}>
          <SelectTrigger className="h-9 w-44 text-body" aria-label={t("search.scope")}>
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
      </div>

      {total === 0 ? (
        <div className="rounded-2xl bg-surface-whisper p-12 text-center">
          <SearchX className="mx-auto mb-3 h-8 w-8 text-subtle" />
          <div className="font-medium text-foreground">
            {t("search.noResultsFor", { query: q })}
          </div>
          <div className="mt-1 text-body text-subtle">
            {t("search.tryDifferent")}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={`${group.recordType}-${group.label}`}>
              <h2 className="mb-2 flex items-center gap-2 text-label text-muted-foreground">
                {scopeLabel(t, group.recordType, group.label)}
                <span className="rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
                  {countLabel(group.results.length, group.hasMore)}
                </span>
              </h2>
              <div className="divide-y divide-row-divider overflow-hidden rounded-2xl bg-card shadow-card">
                {group.results.map((item) => (
                  <ResultCard key={item.key} item={item} term={q} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
