import { formatDate, formatExactTime, formatRelativeShort } from "@/lib/format";
import {
  EditableMoney,
  EditableStage,
  EditableDate,
} from "@/components/deals/inline-edit";
import { Combobox } from "@/components/ui/combobox";

// Sentinel for "no owner" in the owner combobox.
const NONE = "__none__";
import { DealSectionCard } from "./deal-section-card";
import type {
  Deal,
  DealUpdate,
  Pipeline,
  Stage,
  UserOption,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";
import { useAuth } from "@/hooks/use-auth";
import { canReassignDeals } from "@/lib/deal-reassign";

// A labelled metric. `control` renders an inline editor; otherwise a read-only
// value that truncates and reveals its full content on hover.
function Metric({
  label,
  value,
  control,
  title,
}: {
  label: string;
  value?: string | null;
  control?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      {control ?? (
        <div
          className="mt-0.5 truncate text-sm font-semibold text-slate-800"
          title={title ?? value ?? undefined}
        >
          {value != null && value !== "" ? (
            value
          ) : (
            <span className="font-normal text-slate-400">—</span>
          )}
        </div>
      )}
    </div>
  );
}

export function DealSummaryCard({
  deal,
  stage,
  stages,
  pipelines,
  users,
  onCommit,
}: {
  deal: Deal;
  stage?: Stage;
  stages: Stage[];
  pipelines: Pipeline[];
  users: UserOption[];
  onCommit: (patch: Partial<DealUpdate>) => void;
}) {
  // Compact relative for the KPI tile (it truncates); the exact time is on
  // hover. Full "exact (relative)" form is used in the timeline/history.
  const { t } = useI18n();
  // In a pipeline locked to admins (adminOnlyReassign) the server refuses an
  // owner change from anyone else, so they see the owner as plain text.
  const canReassign = canReassignDeals(
    useAuth().user?.isAdmin === true,
    [deal.pipelineId],
    pipelines,
  );
  const lastActivity = deal.lastActivityTime
    ? formatRelativeShort(deal.lastActivityTime)
    : null;
  const ownerTeam = users.find((u) => u.id === deal.ownerId)?.teamName ?? null;

  return (
    <DealSectionCard title={t("deals.summary.title")} bodyClassName="p-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Metric
          label={t("common.value")}
          control={
            <EditableMoney
              value={deal.value}
              currency={deal.currency}
              onCommit={(v) => onCommit({ value: v })}
              className="-ms-1 mt-0.5 w-full text-sm font-semibold text-slate-800"
            />
          }
        />
        <Metric
          label={t("deals.summary.probability")}
          value={stage ? `${stage.probability}%` : null}
        />
        <Metric
          label={t("deals.summary.closeDate")}
          control={
            <EditableDate
              value={deal.expectedCloseDate}
              onCommit={(next) => onCommit({ expectedCloseDate: next })}
              className="-ms-1 mt-0.5 w-full font-semibold"
            />
          }
        />
        <Metric
          label={t("common.stage")}
          control={
            <div className="-ms-1 mt-0.5">
              <EditableStage
                deal={deal}
                stages={stages}
                onCommit={(stageId) => onCommit({ stageId })}
              />
            </div>
          }
        />
        <Metric
          label={t("common.owner")}
          control={
            <div className="-ms-1 mt-0.5">
              {canReassign ? (
                <Combobox
                  items={users.map((u) => ({
                    value: String(u.id),
                    label: u.name,
                  }))}
                  value={deal.ownerId != null ? String(deal.ownerId) : NONE}
                  onChange={(v) =>
                    onCommit({ ownerId: v === NONE ? null : Number(v) })
                  }
                  allValue={NONE}
                  allLabel={t("common.unassigned")}
                  // A deactivated owner is absent from the active-only options;
                  // keep showing their name, never the raw id.
                  fallbackLabel={deal.ownerName ?? undefined}
                  placeholder={t("activity.row.searchUsers")}
                  // Render the popover in place (not portalled). The deal detail
                  // renders inside a Sheet in drawer mode; a portalled popover
                  // lands outside the Sheet's scroll-lock allowlist and its list
                  // can't be wheel-scrolled. In-place is clip-safe — Radix
                  // positions the popover `fixed`, so page mode is unaffected.
                  inModal
                  triggerClassName="h-8 w-full justify-between border-transparent bg-transparent px-1 text-sm font-semibold text-slate-800 shadow-none hover:bg-slate-100"
                />
              ) : (
                <div
                  className="flex h-8 items-center truncate px-1 text-sm font-semibold text-slate-800"
                  title={deal.ownerName ?? undefined}
                >
                  {deal.ownerName ?? (
                    <span className="font-normal text-slate-400">
                      {t("common.unassigned")}
                    </span>
                  )}
                </div>
              )}
              {ownerTeam && (
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {ownerTeam}
                </div>
              )}
            </div>
          }
        />
        <Metric
          label={t("deals.field.lastActivity")}
          value={lastActivity ?? t("deals.summary.noActivity")}
          title={
            deal.lastActivityTime
              ? formatExactTime(deal.lastActivityTime)
              : undefined
          }
        />
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        {t("deals.summary.added", { date: formatDate(deal.addTime) })}
      </div>
    </DealSectionCard>
  );
}
