import type { ReactNode } from "react";
import type { ChangesFeedItem } from "@workspace/api-client-react";
import { prettifyKey } from "@/components/shared/entity-timeline";

// Rendering for `change_events` feed rows, shared by whatever surfaces the
// audit feed. Lifted out of the old home-page widget when the feed moved to the
// topbar History menu, so the sentence logic has one home rather than being
// copied per surface.

function valueLabel(
  v: { id?: unknown; label?: string | null } | null | undefined,
): string {
  if (!v) return "—";
  return v.label ?? (v.id != null ? String(v.id) : "—");
}

function changeActorName(item: ChangesFeedItem): string {
  if (item.changedByName) return item.changedByName;
  if (item.source === "automation") return "Automation";
  if (item.source === "import") return "Import";
  return "Someone";
}

export function changeHref(item: ChangesFeedItem): string {
  switch (item.targetType) {
    case "deal":
      return `/deal/${item.targetId}`;
    case "person":
      return `/person/${item.targetId}`;
    default:
      return `/organization/${item.targetId}`;
  }
}

/** One human sentence for a change row, with the target emphasised. */
function changeSentence(item: ChangesFeedItem): ReactNode {
  const target = (
    <span className="font-medium text-foreground">
      {item.targetTitle ?? `#${item.targetId}`}
    </span>
  );
  if (item.entityType === "note") {
    if (item.fieldKey === "deleted") return <>removed a note from {target}</>;
    if (item.fieldKey === "created") return <>added a note on {target}</>;
    return <>updated a note on {target}</>;
  }
  if (item.fieldKey === "created") return <>created {target}</>;
  if (item.fieldKey === "deleted") return <>deleted {target}</>;
  if (item.fieldKey === "stage_id")
    return (
      <>
        moved {target} to{" "}
        <span className="font-medium text-foreground">
          {valueLabel(item.newValue)}
        </span>
      </>
    );
  if (item.fieldKey === "owner_id")
    return (
      <>
        assigned {target} to{" "}
        <span className="font-medium text-foreground">
          {valueLabel(item.newValue)}
        </span>
      </>
    );
  // File uploads/removals are logged as "file:<id>"; render a proper sentence
  // instead of falling through to the generic branch below (which would print
  // "changed file:123 on <target> to contract.pdf").
  if (item.fieldKey.startsWith("file:")) {
    const isDelete = item.newValue == null;
    const fileLabel =
      (isDelete ? item.oldValue?.label : item.newValue?.label) ?? "a file";
    return isDelete ? (
      <>
        removed <span className="font-medium text-foreground">{fileLabel}</span>{" "}
        from {target}
      </>
    ) : (
      <>
        uploaded <span className="font-medium text-foreground">{fileLabel}</span>{" "}
        to {target}
      </>
    );
  }
  return (
    <>
      changed {prettifyKey(item.fieldKey).toLowerCase()} on {target} to{" "}
      <span className="font-medium text-foreground">
        {valueLabel(item.newValue)}
      </span>
    </>
  );
}

/** "<Actor> <did something to> <target>" — the full row sentence. */
export function changeFullSentence(item: ChangesFeedItem): ReactNode {
  return (
    <>
      <span className="font-medium text-foreground">
        {changeActorName(item)}
      </span>{" "}
      {changeSentence(item)}
    </>
  );
}
