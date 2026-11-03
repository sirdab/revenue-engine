import { useMemo, useState } from "react";
import {
  useAdminListAutomations,
  getAdminListAutomationsQueryKey,
  useUpdateAutomation,
  useDeleteAutomation,
  useReorderAutomations,
  useListPipelines,
  getListPipelinesQueryKey,
  useListDealOwners,
  getListDealOwnersQueryKey,
} from "@workspace/api-client-react";
import type {
  Automation,
  AutomationTriggerEvent,
  DealOwner,
  Pipeline,
} from "@workspace/api-client-react";
import { countConditions, type FilterGroup } from "@workspace/deals-filter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/settings/section-card";
import { errorMessage } from "@/lib/api-error";
import { AutomationWizard } from "@/components/settings/automation-wizard";

// Settings → Automations: admin management for automations ("when X happens →
// do Y"). One flat list ordered by trigger; automations sharing a trigger run in
// the order shown (ALL matching automations run — unlike assignment rules there
// is no first-match-wins). Every mutation invalidates the list key so the panel
// stays in sync.
//
// Each row says in plain words what starts it and what it does.

const EVENT_ORDER: AutomationTriggerEvent[] = ["deal_added", "deal_updated"];

function actionLabel(
  a: Automation,
  pipelines: Pipeline[],
  owners: DealOwner[],
): string {
  const cfg = a.actionConfig;
  if (a.actionType === "call_webhook") {
    let host = cfg.url ?? "webhook";
    try {
      host = new URL(cfg.url ?? "").host || host;
    } catch {
      /* keep raw url text */
    }
    return `send it to ${host}`;
  }
  if (a.actionType === "send_slack_message") {
    const dest =
      cfg.destination?.kind === "channel"
        ? cfg.destination.channel || "default channel"
        : cfg.destination?.kind === "user"
          ? (owners.find((o) => o.id === cfg.destination?.userId)?.name ??
            "user")
          : "the deal owner";
    return `post it to Slack (${dest})`;
  }
  if (a.actionType === "post_notification") {
    // Everyone gets these; there is no per-person opt-in any more, so saying
    // "subscribers" here would send people looking for a switch that is gone.
    return "alert the team in the app";
  }
  if (a.actionType === "create_activity") {
    const who =
      cfg.assignee?.kind === "user"
        ? (owners.find((o) => o.id === cfg.assignee?.userId)?.name ?? "user")
        : "the deal owner";
    const days = cfg.dueInDays ?? 0;
    return `create a ${cfg.activityType ?? "call"} for ${who}, due in ${days} day${days === 1 ? "" : "s"}`;
  }
  const pipeline =
    pipelines.find((p) => p.id === cfg.pipelineId)?.name ?? "pipeline";
  const who =
    cfg.owner?.kind === "user"
      ? (owners.find((o) => o.id === cfg.owner?.userId)?.name ?? "user")
      : cfg.owner?.kind === "auto"
        ? "auto-assigned"
        : "the deal owner";
  return `create a deal in ${pipeline}, owned by ${who}`;
}

function AutomationRow({
  automation,
  summary,
  index,
  count,
  busy,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  automation: Automation;
  summary: string;
  index: number;
  count: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const conditionCount = countConditions(automation.conditions as FilterGroup);
  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-5 py-3.5",
        !automation.active && "opacity-60",
      )}
    >
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
          aria-label="Move up"
          className="text-slate-300 transition-colors hover:text-slate-600 disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
          aria-label="Move down"
          className="text-slate-300 transition-colors hover:text-slate-600 disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">
          {automation.name}
        </p>
        <p className="truncate text-xs text-slate-500">
          {automation.triggerEvent === "deal_updated"
            ? conditionCount === 0
              ? "Any change to any deal"
              : `A deal changes to match ${conditionCount} condition${conditionCount === 1 ? "" : "s"}`
            : conditionCount === 0
              ? "Every new deal"
              : `A new deal matching ${conditionCount} condition${conditionCount === 1 ? "" : "s"}`}
          {" — "}
          {summary}
        </p>
      </div>

      <Switch
        checked={automation.active}
        onCheckedChange={onToggle}
        disabled={busy}
        aria-label={
          automation.active ? "Deactivate automation" : "Activate automation"
        }
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onEdit}
        aria-label={`Edit ${automation.name}`}
        className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-slate-700 group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Delete ${automation.name}`}
            className="h-7 w-7 shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{automation.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This automation will stop running. Activities and deals it
              already created are kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete automation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function AutomationsSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);

  const { data, isLoading, isError } = useAdminListAutomations({
    query: { queryKey: getAdminListAutomationsQueryKey() },
  });
  // Display names for action summaries (config stores raw ids).
  const { data: pipelines } = useListPipelines({
    query: { queryKey: getListPipelinesQueryKey() },
  });
  const { data: owners } = useListDealOwners({
    query: { queryKey: getListDealOwnersQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getAdminListAutomationsQueryKey(),
    });
  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });

  const update = useUpdateAutomation({
    mutation: { onSuccess: invalidate, onError },
  });
  const remove = useDeleteAutomation({
    mutation: { onSuccess: invalidate, onError },
  });
  const reorder = useReorderAutomations({
    mutation: { onSuccess: invalidate, onError },
  });
  const busy = update.isPending || remove.isPending || reorder.isPending;

  // The list arrives ordered by event then priority; group it by event.
  const byEvent = useMemo(() => {
    const map: Record<AutomationTriggerEvent, Automation[]> = {
      deal_added: [],
      deal_updated: [],
    };
    for (const a of data?.automations ?? []) map[a.triggerEvent].push(a);
    return map;
  }, [data]);

  const total = data?.automations.length ?? 0;

  // Reordering is per trigger: priority only means anything between automations
  // the same event starts.
  const move = (
    triggerEvent: AutomationTriggerEvent,
    index: number,
    dir: -1 | 1,
  ) => {
    const next = [...byEvent[triggerEvent]];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({ data: { triggerEvent, orderedIds: next.map((a) => a.id) } });
  };

  const openCreate = () => {
    setEditing(null);
    setWizardOpen(true);
  };
  const openEdit = (automation: Automation) => {
    setEditing(automation);
    setWizardOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="font-heading text-xl font-bold text-slate-900">
          Automations
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          When something happens — a deal comes in, a deal moves stage, a deal
          is won — have the app do the next step for you.
        </p>
      </header>

      <SectionCard
        title="Automations"
        description="Each one runs by itself, in the order shown. Switch one off to pause it."
        actions={
          <Button
            size="sm"
            onClick={openCreate}
            className="h-8 bg-teal-600 text-white hover:bg-teal-700"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> Automation
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading automations…
          </div>
        ) : isError || !data ? (
          <div className="px-5 py-10 text-center text-sm text-red-600">
            Failed to load automations.
          </div>
        ) : total === 0 ? (
          <div className="px-5 py-10 text-center">
            <Zap className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            <p className="text-sm text-slate-500">No automations yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Add one to take a repetitive step off your plate.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {EVENT_ORDER.filter((event) => byEvent[event].length > 0).flatMap(
              (event) =>
                byEvent[event].map((automation, i) => (
                  <AutomationRow
                    key={automation.id}
                    automation={automation}
                    summary={actionLabel(
                      automation,
                      pipelines ?? [],
                      owners ?? [],
                    )}
                    index={i}
                    count={byEvent[event].length}
                    busy={busy}
                    onToggle={() =>
                      update.mutate({
                        id: automation.id,
                        data: { active: !automation.active },
                      })
                    }
                    onEdit={() => openEdit(automation)}
                    onDelete={() => remove.mutate({ id: automation.id })}
                    onMove={(dir) => move(event, i, dir)}
                  />
                )),
            )}
          </ul>
        )}
      </SectionCard>

      <AutomationWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editingAutomation={editing}
      />
    </div>
  );
}
