import { Sparkles, Trash2, User, Tag, PencilLine, History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@sirdab/one/components/empty-state";
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
        accent: "bg-muted text-muted-foreground",
      };
    case "deleted":
      return {
        title: t("contacts.history.orgDeleted"),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        accent: "bg-destructive-subtle text-destructive",
      };
    case "owner_id":
      return {
        title: (
          <span>{tNode("deals.timeline.ownerChange", { owner: strong(newL) })}</span>
        ),
        icon: <User className="h-3.5 w-3.5" />,
        accent: "bg-warning-subtle text-warning",
      };
    case "labels":
      return {
        title: (
          <span>{tNode("contacts.history.labelsChange", { labels: strong(newL) })}</span>
        ),
        icon: <Tag className="h-3.5 w-3.5" />,
        accent: "bg-muted text-muted-foreground",
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
        accent: "bg-muted text-muted-foreground",
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
        <EmptyState
          className="py-8"
          icon={History}
          title={t("history.empty")}
          caption={t("contacts.history.orgHint")}
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([key, dayEvents]) => (
            <div key={key}>
              <div className="mb-2.5 text-caption text-muted-foreground">
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
