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
import { useI18n, type MessageKey, type Translate, type TranslatePlural } from "@/lib/i18n/i18n";

// Settings → Automations: admin management for automations ("when X happens →
// do Y"). One flat list ordered by trigger; automations sharing a trigger run in
// the order shown (ALL matching automations run — unlike assignment rules there
// is no first-match-wins). Every mutation invalidates the list key so the panel
// stays in sync.
//
// The trigger tabs and the long footnote explaining them are gone. Sales
// teams read this page, not engineers: each row says in plain words what starts it and
// what it does, which is what the tabs and the footnote were there to say.

const EVENT_ORDER: AutomationTriggerEvent[] = ["deal_added", "deal_updated"];

const ACTIVITY_NOUN_KEYS: Record<string, MessageKey> = {
  call: "settings.automations.activityNoun.call",
  meeting: "settings.automations.activityNoun.meeting",
  email: "settings.automations.activityNoun.email",
  task: "settings.automations.activityNoun.task",
  deadline: "settings.automations.activityNoun.deadline",
  whatsapp: "settings.automations.activityNoun.whatsapp",
};

function actionLabel(
  a: Automation,
  pipelines: Pipeline[],
  owners: DealOwner[],
  t: Translate,
  tPlural: TranslatePlural,
): string {
  const cfg = a.actionConfig;
  if (a.actionType === "call_webhook") {
    let host = cfg.url ?? t("settings.automations.summary.webhook");
    try {
      host = new URL(cfg.url ?? "").host || host;
    } catch {
      /* keep raw url text */
    }
    return t("settings.automations.summary.sendTo", { host });
  }
  if (a.actionType === "send_slack_message") {
    const dest =
      cfg.destination?.kind === "channel"
        ? cfg.destination.channel ||
          t("settings.automations.summary.defaultChannel")
        : cfg.destination?.kind === "user"
          ? (owners.find((o) => o.id === cfg.destination?.userId)?.name ??
            t("settings.automations.summary.user"))
          : t("settings.automations.summary.dealOwner");
    return t("settings.automations.summary.slack", { destination: dest });
  }
  if (a.actionType === "post_notification") {
    // Everyone gets these; there is no per-person opt-in any more, so saying
    // "subscribers" here would send people looking for a switch that is gone.
    return t("settings.automations.summary.alertTeam");
  }
  if (a.actionType === "create_activity") {
    const who =
      cfg.assignee?.kind === "user"
        ? (owners.find((o) => o.id === cfg.assignee?.userId)?.name ??
          t("settings.automations.summary.user"))
        : t("settings.automations.summary.dealOwner");
    const days = cfg.dueInDays ?? 0;
    const typeKey = ACTIVITY_NOUN_KEYS[cfg.activityType ?? "call"];
    return tPlural("settings.automations.summary.createActivity", days, {
      type: typeKey ? t(typeKey) : (cfg.activityType ?? ""),
      assignee: who,
    });
  }
  const pipeline =
    pipelines.find((p) => p.id === cfg.pipelineId)?.name ??
    t("settings.automations.summary.pipeline");
  const who =
    cfg.owner?.kind === "user"
      ? (owners.find((o) => o.id === cfg.owner?.userId)?.name ??
        t("settings.automations.summary.user"))
      : cfg.owner?.kind === "auto"
        ? t("settings.automations.summary.autoAssigned")
        : t("settings.automations.summary.dealOwner");
  return t("settings.automations.summary.createDeal", { pipeline, owner: who });
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
  const { t, tPlural } = useI18n();
  const conditionCount = countConditions(automation.conditions as FilterGroup);
  const triggerText =
    automation.triggerEvent === "deal_updated"
      ? conditionCount === 0
        ? t("settings.automations.row.anyChange")
        : tPlural("settings.automations.row.changesToMatch", conditionCount)
      : conditionCount === 0
        ? t("settings.automations.row.everyNew")
        : tPlural("settings.automations.row.newMatching", conditionCount);
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
          aria-label={t("settings.assignmentRules.moveUp")}
          className="text-subtle transition-colors hover:text-muted-foreground disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
          aria-label={t("settings.assignmentRules.moveDown")}
          className="text-subtle transition-colors hover:text-muted-foreground disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-start text-body font-semibold text-foreground">
          {automation.name}
        </p>
        <p className="truncate text-caption-quiet text-muted-foreground">
          {t("settings.automations.row.summary", {
            trigger: triggerText,
            action: summary,
          })}
        </p>
      </div>

      <Switch
        checked={automation.active}
        onCheckedChange={onToggle}
        disabled={busy}
        aria-label={
          automation.active
            ? t("settings.automations.deactivate")
            : t("settings.automations.activate")
        }
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onEdit}
        aria-label={t("settings.assignmentRules.edit", { name: automation.name })}
        className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={t("settings.assignmentRules.delete", { name: automation.name })}
            className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.assignmentRules.deleteTitle", { name: automation.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.automations.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive"
            >
              {t("settings.automations.deleteConfirm")}
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
  const { t, tPlural } = useI18n();
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
        <h1 className="text-heading-sm text-foreground">
          {t("settings.automations.title")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          {t("settings.automations.subtitle")}
        </p>
      </header>

      <SectionCard
        title={t("settings.automations.title")}
        description={t("settings.automations.cardDescription")}
        actions={
          <Button
            size="sm"
            onClick={openCreate}
            className="h-8 bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> {t("settings.automations.add")}
          </Button>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-body-quiet text-subtle">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("settings.automations.loading")}
          </div>
        ) : isError || !data ? (
          <div className="px-5 py-10 text-center text-body-quiet text-destructive">
            {t("settings.automations.loadFailed")}
          </div>
        ) : total === 0 ? (
          <div className="px-5 py-10 text-center">
            <Zap className="mx-auto mb-2 h-6 w-6 text-subtle" />
            <p className="text-body-quiet text-muted-foreground">{t("settings.automations.empty")}</p>
            <p className="mt-1 text-caption-quiet text-subtle">
              {t("settings.automations.emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
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
                      t,
                      tPlural,
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
