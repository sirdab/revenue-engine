import { DealSectionCard, DealField } from "./deal-section-card";
import { EditableTextarea } from "@/components/deals/inline-edit";
import { AsyncSelect } from "@/components/ui/async-select";
import {
  loadPersonOptions,
  loadOrganizationOptions,
} from "@/lib/contacts-search-api";
import { formatTimestamp } from "@/lib/format";
import type { Deal, DealUpdate, Person } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n/i18n";

// Read-only attribution value: stays on one line, truncates opaque IDs, and
// reveals the full string on hover.
function AttributionField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

export function DealDetailsCard({
  deal,
  person,
  onCommit,
}: {
  deal: Deal;
  person?: Person;
  onCommit: (patch: Partial<DealUpdate>) => void;
}) {
  // Attribution is read-only metadata. Click-tracking IDs (gclid/fbclid) are
  // intentionally never surfaced; campaign/keyword often hold opaque IDs, so
  // they truncate with a hover tooltip rather than dominating the panel.
  const { t } = useI18n();
  const attribution = [
    { label: t("common.source"), value: deal.utmSource },
    { label: t("deals.details.medium"), value: deal.utmMedium },
    { label: t("deals.details.campaign"), value: deal.utmCampaign },
    { label: t("deals.details.keyword"), value: deal.utmKeyword },
    { label: t("deals.details.ad"), value: deal.adName },
  ].filter((a): a is { label: string; value: string } => Boolean(a.value));

  return (
    <DealSectionCard title={t("common.details")} collapsible defaultOpen>
      {/* Additional requirements — editable multi-line */}
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
          {t("deals.details.additionalRequirements")}
        </div>
        <EditableTextarea
          value={deal.comments}
          onCommit={(v) => onCommit({ comments: v })}
          placeholder={t("deals.details.requirementsPlaceholder")}
        />
      </div>

      {/* Linked records — person & organization editable; contact info read-only */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4">
        <DealField label={t("common.person")}>
          <AsyncSelect
            value={deal.personId != null ? String(deal.personId) : null}
            valueLabel={person?.name ?? deal.personName}
            loadOptions={loadPersonOptions}
            onChange={(v) =>
              onCommit({ personId: v ? Number(v) : null })
            }
            allValue=""
            allLabel={t("activity.add.noPerson")}
            placeholder={t("common.searchPeople")}
            inModal
            triggerClassName="h-8 w-full border-transparent bg-transparent px-1 text-sm shadow-none hover:bg-gray-alpha-100"
          />
        </DealField>
        <DealField label={t("common.organization")}>
          <AsyncSelect
            value={
              deal.organizationId != null ? String(deal.organizationId) : null
            }
            valueLabel={deal.organizationName}
            loadOptions={loadOrganizationOptions}
            onChange={(v) =>
              onCommit({ organizationId: v ? Number(v) : null })
            }
            allValue=""
            allLabel={t("deals.create.noOrg")}
            placeholder={t("common.searchOrganizations")}
            inModal
            triggerClassName="h-8 w-full border-transparent bg-transparent px-1 text-sm shadow-none hover:bg-gray-alpha-100"
          />
        </DealField>
        <DealField label={t("common.phone")} value={person?.phone} />
        <DealField label={t("common.email")} value={person?.email} />
      </div>

      {/* Source / attribution — read-only, tracking IDs hidden */}
      {attribution.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">
            {t("deals.details.attribution")}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {attribution.map((a) => (
              <AttributionField key={a.label} label={a.label} value={a.value} />
            ))}
          </div>
        </div>
      )}

      {/* Record metadata — read-only lifecycle timestamps, only what's set */}
      <div className="mt-4 border-t border-border pt-4">
        {deal.status === "lost" && deal.lostReason && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-destructive">
              {t("deals.field.lostReason")}
            </div>
            <div className="mt-0.5 text-sm text-destructive">{deal.lostReason}</div>
            {deal.lostReasonNote && (
              <div className="mt-1.5 whitespace-pre-wrap text-sm text-destructive/90">
                {deal.lostReasonNote}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {[
            { label: t("common.created"), value: formatTimestamp(deal.addTime) },
            { label: t("common.lastUpdated"), value: formatTimestamp(deal.updateTime) },
            {
              label: t("deals.details.stageEntered"),
              value: deal.stageChangeTime
                ? formatTimestamp(deal.stageChangeTime)
                : null,
            },
            {
              label: t("common.won"),
              value: deal.wonTime ? formatTimestamp(deal.wonTime) : null,
            },
            {
              label: t("common.lost"),
              value: deal.lostTime ? formatTimestamp(deal.lostTime) : null,
            },
            {
              label: t("common.closed"),
              value: deal.closeTime ? formatTimestamp(deal.closeTime) : null,
            },
          ]
            .filter((m) => m.value)
            .map((m) => (
              <div key={m.label} className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                  {m.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{m.value}</div>
              </div>
            ))}
        </div>
      </div>
    </DealSectionCard>
  );
}
