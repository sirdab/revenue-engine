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
import { DealsCount, DealsToolbar } from "./deals-toolbar";
import { OpenModeToggle } from "./open-mode-toggle";
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
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
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
  const [openMode, setOpenMode] = useDealOpenMode();
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header: title, live count and the create action; then the view
          switcher, the status lens (list only, the one view whose rows the
          open-only default silently hides) and the filters. */}
      <div className="flex flex-col gap-3 border-b border-border px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-heading-sm text-foreground">
            {t("common.deals")}
          </h1>
          <DealsCount state={state} />
          <div className="ms-auto flex items-center gap-2">
            {/* Deal-click open mode: full page vs. side drawer (deals.openMode). */}
            <OpenModeToggle value={openMode} onChange={setOpenMode} />
            <CreateDealMenu defaultPipelineId={state.pipelineId} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitcher
            value={state.view}
            onChange={(view) => update({ view })}
          />
          {state.view === "list" && (
            <StatusFilter
              value={state.status}
              onChange={(status) => update({ status })}
            />
          )}
          <DealsToolbar state={state} update={update} />
        </div>
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
