import { Sparkles, Trash2, User, Tag, PencilLine, History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { DealSectionCard } from "@/components/deals/detail/deal-section-card";
import {
  snapshotLabel,
  prettifyKey,
  dayLabel,
  groupChangeEventsByDay,
  ChangeEventRow,
  type ChangeDescription,
} from "@/components/shared/entity-timeline";
import type { ChangeEvent } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { useI18n, type I18n } from "@/lib/i18n/i18n";

// Field-key vocabulary for organization change_events, matching
// TRACKED_ORG_FIELDS in artifacts/api-server/src/lib/change-events.ts.
const strong = (text: ReactNode) => <span className="font-semibold">{text}</span>;

function describeOrgChange({ t, tNode }: Pick<I18n, "t" | "tNode">, e: ChangeEvent): ChangeDescription {
  const oldL = snapshotLabel(e.oldValue);
  const newL = snapshotLabel(e.newValue);
  switch (e.fieldKey) {
    case "created":
      return {
        title: t("contacts.history.orgCreated"),
        icon: <Sparkles className="h-3.5 w-3.5" />,
        accent: "bg-teal-50 text-teal-600",
      };
    case "deleted":
      return {
        title: t("contacts.history.orgDeleted"),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        accent: "bg-red-50 text-red-500",
      };
    case "owner_id":
      return {
        title: (
          <span>{tNode("deals.timeline.ownerChange", { owner: strong(newL) })}</span>
        ),
        icon: <User className="h-3.5 w-3.5" />,
        accent: "bg-amber-50 text-amber-600",
      };
    case "labels":
      return {
        title: (
          <span>{tNode("contacts.history.labelsChange", { labels: strong(newL) })}</span>
        ),
        icon: <Tag className="h-3.5 w-3.5" />,
        accent: "bg-slate-100 text-slate-500",
      };
    default:
      return {
        title: (
          <span>
            {e.oldValue
              ? tNode("deals.timeline.fieldChange", { field: prettifyKey(e.fieldKey), from: strong(oldL), to: strong(newL) })
              : tNode("deals.timeline.fieldSet", { field: prettifyKey(e.fieldKey), to: strong(newL) })}
          </span>
        ),
        icon: <PencilLine className="h-3.5 w-3.5" />,
        accent: "bg-slate-100 text-slate-500",
      };
  }
}

export function OrganizationHistory({
  events,
  loading,
}: {
  events: ChangeEvent[];
  loading?: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const groups = groupChangeEventsByDay(events);

  return (
    <DealSectionCard title={t("common.history")}>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-6 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty className="border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History className="h-4 w-4" />
            </EmptyMedia>
            <EmptyTitle>{t("history.empty")}</EmptyTitle>
            <EmptyDescription>
              {t("contacts.history.orgHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map(([key, dayEvents]) => (
            <div key={key}>
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {dayLabel(new Date(key))}
              </div>
              <div className="space-y-2.5">
                {dayEvents.map((e) => (
                  <ChangeEventRow key={e.id} event={e} describe={(ev) => describeOrgChange(i18n, ev)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </DealSectionCard>
  );
}
