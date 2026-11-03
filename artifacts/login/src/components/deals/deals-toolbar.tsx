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
import { OpenModeToggle } from "./open-mode-toggle";
import {
  useDealsSummary,
  type DealCurrencyTotal,
} from "@/lib/deals-summary-api";
import { useDealOpenMode } from "@/hooks/use-user-preferences";
import type { DealsUrlState } from "./use-deals-url-state";
import { useI18n } from "@/lib/i18n/i18n";
import { formatNumber } from "@/lib/format";

const ALL = "__all__";

// One "value · weighted · count" line of the totals popover.
function TotalsRow({ total }: { total: DealCurrencyTotal }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 tabular-nums">
      <span className="font-medium text-slate-800">
        <Money value={total.value} currency={total.currency} />
      </span>
      <span
        className="flex items-center gap-1 text-slate-600"
        title={t("deals.toolbar.weightedTitle")}
      >
        <Scale className="h-3.5 w-3.5 text-slate-400" />
        <Money value={total.weightedValue} currency={total.currency} />
      </span>
      <span className="text-slate-400">
        {total.count.toLocaleString()} {total.count === 1 ? "deal" : "deals"}
      </span>
    </div>
  );
}

// Live count plus the totals popover: overall and per-currency sums of deal
// value alongside the stage-probability-weighted forecast value.
function DealsCount({ state }: { state: DealsUrlState }) {
  const { t } = useI18n();
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
    <div className="flex items-center gap-1.5 text-sm text-slate-500">
      {isFetching && data == null ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <span className="font-semibold text-slate-700">{count ?? 0}</span>
      )}
      <span>{count === 1 ? "deal" : "deals"}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("deals.toolbar.totalsAria")}
            className="rounded-full text-slate-400 transition-colors hover:text-slate-600"
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] p-3 text-sm">
          {totals.length === 0 ? (
            <p className="text-slate-400">{t("deals.toolbar.noneInView")}</p>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("common.total")}
                </div>
                {totals.length === 1 ? (
                  <TotalsRow total={totals[0]} />
                ) : (
                  // Mixed currencies never sum into one number — the honest
                  // total is the deal count; the money lives per currency.
                  <div className="tabular-nums text-slate-600">
                    {t("deals.toolbar.acrossCurrencies", { count: formatNumber(count ?? 0), currencies: totals.length })}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 pt-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("deals.toolbar.byCurrency")}
                </div>
                <div className="space-y-1">
                  {totals.map((total) => (
                    <TotalsRow key={total.currency} total={total} />
                  ))}
                </div>
              </div>
              <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">
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
  const [openMode, setOpenMode] = useDealOpenMode();

  return (
    <div className="ms-auto flex flex-wrap items-center gap-2">
      <DealsSearchInput state={state} update={update} />
      <DealsCount state={state} />

      {/* Deal-click open mode: full page vs. right-side drawer (deals.openMode). */}
      <OpenModeToggle value={openMode} onChange={setOpenMode} />

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
        triggerClassName="w-[180px]"
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
          triggerClassName="w-[160px]"
        />
        {state.ownerId != null && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-500"
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
        variant={state.archived ? "default" : "outline"}
        size="sm"
        onClick={() =>
          update({ archived: state.archived ? undefined : true, view: "list" })
        }
        title={
          state.archived
            ? t("deals.toolbar.showingArchived")
            : t("deals.toolbar.showArchived")
        }
        className={
          state.archived
            ? "h-8 gap-1.5 bg-amber-600 px-2.5 text-xs text-white hover:bg-amber-700"
            : "h-8 gap-1.5 px-2.5 text-xs text-slate-500"
        }
      >
        <ArchiveIcon className="h-3.5 w-3.5" />
        {t("common.archived")}
      </Button>
    </div>
  );
}
