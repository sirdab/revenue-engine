import { useListPipelines } from "@workspace/api-client-react";
import { encodeFilters } from "@workspace/deals-filter";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { Board } from "@/pages/board";
import { useDealsUrlState, type DealsUrlState } from "./use-deals-url-state";
import { ViewSwitcher } from "./view-switcher";
import { StatusFilter } from "./status-filter";
import { CreateDealMenu } from "./create-deal-menu";
import { DealsToolbar } from "./deals-toolbar";
import { DealsListView } from "./deals-list-view";
import { DealsForecastView } from "./deals-forecast-view";
import { DealsFunnelView } from "./deals-funnel-view";
import { DealDetailDrawer } from "@/pages/deal-detail";
import { useDealOpenMode } from "@/hooks/use-user-preferences";
import { useI18n } from "@/lib/i18n/i18n";

function PipelineView({
  pipelineId,
  ownerId,
  q,
  filters,
  onStageClick,
  onOpenDeal,
}: {
  pipelineId?: number;
  ownerId?: number;
  q?: string;
  filters?: string;
  onStageClick: (stageId: number) => void;
  onOpenDeal: (dealId: number) => void;
}) {
  const { data: pipelines, isLoading } = useListPipelines();
  const resolved = pipelineId ?? pipelines?.[0]?.id;

  if (isLoading || resolved == null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden p-3">
      <Board
        pipelineId={resolved}
        ownerId={ownerId}
        q={q}
        filters={filters}
        onStageClick={onStageClick}
        onOpenDeal={onOpenDeal}
      />
    </div>
  );
}

export function DealsWorkspace() {
  const { t } = useI18n();
  const { state, update } = useDealsUrlState();
  const [openMode] = useDealOpenMode();
  const [openDealId, setOpenDealId] = useState<number | null>(null);
  const [, navigate] = useLocation();

  // Stage column click: shortcut into the list view filtered to that stage,
  // reusing the existing filter DSL/URL-state rather than a bespoke param.
  const goToStage = (stageId: number) => {
    const partial: Partial<DealsUrlState> = {
      view: "list",
      archived: undefined,
      filters: encodeFilters({
        combinator: "and",
        conditions: [{ field: "stage", operator: "is", value: stageId }],
      }),
    };
    update(partial);
  };

  const openDeal = (dealId: number) => {
    if (openMode === "drawer") {
      setOpenDealId(dealId);
      return;
    }
    navigate(`/deal/${dealId}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* Top row: title, count + filters/search, and the create action. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
        <h1 className="font-heading text-xl font-bold tracking-tight text-slate-900">
          {t("common.deals")}
        </h1>
        <DealsToolbar state={state} update={update} />
        <CreateDealMenu defaultPipelineId={state.pipelineId} />
      </div>

      {/* Second row: the view switcher (pipeline / list / forecast / …), plus
          the status lens — list-only, since it is the one view whose rows the
          open-only default silently hides. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2">
        <ViewSwitcher
          value={state.view}
          onChange={(view) => update({ view })}
        />
        {state.view === "list" && (
          <div className="ms-auto">
            <StatusFilter
              value={state.status}
              onChange={(status) => update({ status })}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.view === "pipeline" && (
          <PipelineView
            pipelineId={state.pipelineId}
            ownerId={state.ownerId}
            q={state.q}
            filters={state.filters}
            onStageClick={goToStage}
            onOpenDeal={openDeal}
          />
        )}
        {state.view === "list" && (
          <DealsListView state={state} update={update} onOpenDeal={openDeal} />
        )}
        {state.view === "forecast" && <DealsForecastView state={state} />}
        {state.view === "funnel" && <DealsFunnelView state={state} />}
      </div>

      <DealDetailDrawer
        dealId={openDealId}
        open={openDealId != null && openMode === "drawer"}
        onOpenChange={(open) => !open && setOpenDealId(null)}
      />
    </div>
  );
}
