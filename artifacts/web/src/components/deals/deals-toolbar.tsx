import {
  useListPipelines,
  useListDealOwners,
} from "@workspace/api-client-react";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  X,
  Loader2,
  Info,
  Scale,
  Archive as ArchiveIcon,
} from "lucide-react";
import { DealsFilterBuilder } from "./deals-filter-builder";
import { DealsSavedViews } from "./deals-saved-views";
import { DealsSearchInput } from "./deals-search-input";
import { Money } from "@/components/shared/money";
import {
  useDealsSummary,
  type DealCurrencyTotal,
} from "@/lib/deals-summary-api";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";
import { formatNumber } from "@/lib/format";

const ALL = "__all__";

// One "value · weighted · count" line of the totals popover.
function TotalsRow({ total }: { total: DealCurrencyTotal }) {
  const { t, tPlural, formatNumber } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 tabular-nums">
      <span className="font-medium text-foreground">
        <Money value={total.value} currency={total.currency} />
      </span>
      <span
        className="flex items-center gap-1 text-muted-foreground"
        title={t("deals.toolbar.weightedTitle")}
      >
        <Scale className="h-3.5 w-3.5 text-subtle" />
        <Money value={total.weightedValue} currency={total.currency} />
      </span>
      <span className="text-subtle">
        {tPlural("deals.toolbar.dealCount", total.count, { count: formatNumber(total.count) })}
      </span>
    </div>
  );
}

// Live count plus the totals popover: overall and per-currency sums of deal
// value alongside the stage-probability-weighted forecast value.
export function DealsCount({ state }: { state: DealsUrlState }) {
  const { t, tPlural } = useI18n();
  const { data, isFetching } = useDealsSummary({
    view: state.view === "funnel" ? "list" : state.view,
    pipelineId: state.pipelineId,
    ownerId: state.ownerId,
    status: state.status,
    filters: state.filters,
    archived: state.archived,
    q: state.q,
  });
  const count = data?.count;
  const totals = data?.totals ?? [];

  return (
    <div className="flex items-center gap-1.5 text-body text-muted-foreground">
      {isFetching && data == null ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span className="font-semibold text-foreground">{count ?? 0}</span>
      )}
      <span>{tPlural("deals.toolbar.dealWord", count ?? 0)}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("deals.toolbar.totalsAria")}
            className="rounded-full text-subtle transition-colors hover:text-foreground"
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" kind="dialog" className="w-[340px] p-3 text-body">
          {totals.length === 0 ? (
            <p className="text-subtle">{t("deals.toolbar.noneInView")}</p>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-caption font-medium text-muted-foreground">
                  {t("common.total")}
                </div>
                {totals.length === 1 ? (
                  <TotalsRow total={totals[0]} />
                ) : (
                  // Mixed currencies never sum into one number — the honest
                  // total is the deal count; the money lives per currency.
                  <div className="tabular-nums text-muted-foreground">
                    {t("deals.toolbar.acrossCurrencies", { count: formatNumber(count ?? 0), currencies: totals.length })}
                  </div>
                )}
              </div>
              <div className="border-t border-border pt-2">
                <div className="mb-1 text-caption font-medium text-muted-foreground">
                  {t("deals.toolbar.byCurrency")}
                </div>
                <div className="space-y-1">
                  {totals.map((total) => (
                    <TotalsRow key={total.currency} total={total} />
                  ))}
                </div>
              </div>
              <p className="border-t border-border pt-2 text-caption text-muted-foreground">
                <Scale className="me-1 inline h-3 w-3" />
                {t("deals.toolbar.weightedNote")}
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Rendered inline at the end of the workspace header row (single-line layout).
export function DealsToolbar({
  state,
  update,
}: {
  state: DealsUrlState;
  update: (partial: Partial<DealsUrlState>) => void;
}) {
  const { t } = useI18n();
  const { data: pipelines } = useListPipelines();
  // Owners that actually have deals — old users with zero deals never appear.
  const { data: owners } = useListDealOwners();

  return (
    <div className="ms-auto flex flex-wrap items-center gap-2">
      <DealsSearchInput state={state} update={update} />

      {/* Pipeline selector */}
      <Combobox
        items={(pipelines ?? []).map((p) => ({
          value: p.id.toString(),
          label: p.name,
        }))}
        value={state.pipelineId?.toString() ?? ALL}
        onChange={(v) =>
          update({ pipelineId: v === ALL ? undefined : Number(v) })
        }
        allValue={ALL}
        allLabel={t("activities.allPipelines")}
        placeholder={t("activities.searchPipelines")}
        triggerClassName="w-[170px]"
      />

      {/* Owner filter + clear */}
      <div className="flex items-center gap-1">
        <Combobox
          items={(owners ?? []).map((o) => ({
            value: o.id.toString(),
            label: o.teamName ? `${o.name} · ${o.teamName}` : o.name,
          }))}
          value={state.ownerId?.toString() ?? ALL}
          onChange={(v) =>
            update({ ownerId: v === ALL ? undefined : Number(v) })
          }
          allValue={ALL}
          allLabel={t("deals.toolbar.allOwners")}
          placeholder={t("deals.toolbar.searchOwners")}
          triggerClassName="w-[150px]"
        />
        {state.ownerId != null && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => update({ ownerId: undefined })}
            aria-label={t("deals.toolbar.clearOwner")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Filter builder */}
      <DealsFilterBuilder state={state} update={update} />

      {/* Saved views */}
      <DealsSavedViews state={state} update={update} />


      {/* Archived lens: flips the list to read-only archived deals. */}
      <Button
        variant="outline"
        size="sm"
        data-state={state.archived ? "on" : "off"}
        aria-pressed={state.archived === true}
        onClick={() =>
          update({ archived: state.archived ? undefined : true, view: "list" })
        }
        title={
          state.archived
            ? t("deals.toolbar.showingArchived")
            : t("deals.toolbar.showArchived")
        }
      >
        <ArchiveIcon />
        {t("common.archived")}
      </Button>
    </div>
  );
}
