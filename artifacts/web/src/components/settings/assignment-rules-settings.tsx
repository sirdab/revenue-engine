import { useMemo, useState } from "react";
import {
  useAdminListAssignmentRules,
  getAdminListAssignmentRulesQueryKey,
  useUpdateAssignmentRule,
  useDeleteAssignmentRule,
  useReorderAssignmentRules,
} from "@workspace/api-client-react";
import type {
  AssignmentRule,
  AssignmentRuleTriggerEvent,
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
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { AssignmentRuleWizard } from "@/components/settings/assignment-rule-wizard";
import { useI18n, type MessageKey, type Translate } from "@/lib/i18n/i18n";

// Settings → Assignment Rules: admin management for the auto-assignment engine.
// Rules are grouped by trigger event into tabs; within a tab they are shown in
// priority order (first match wins) with up/down reorder, an active toggle,
// edit (reopens the wizard pre-filled), and delete. Every mutation invalidates
// the list key so the panel stays in sync without a manual refresh.

const EVENT_TABS: {
  id: AssignmentRuleTriggerEvent;
  labelKey: MessageKey;
}[] = [
  { id: "deal_added", labelKey: "settings.assignmentRules.trigger.added" },
  { id: "deal_updated", labelKey: "settings.assignmentRules.trigger.updated" },
];

function targetLabel(rule: AssignmentRule, t: Translate): string {
  if (rule.targetAssigneeId != null) {
    return rule.targetAssigneeName ?? t("settings.assignmentRules.assignee");
  }
  return t("settings.assignmentRules.roundRobin", {
    team: rule.targetTeamName ?? t("common.team"),
  });
}

// Appended to the summary for deal-updated rules that may reassign owned deals.
function takeoverHint(rule: AssignmentRule, t: Translate): string {
  return rule.takeoverOwned ? t("settings.assignmentRules.takesOver") : "";
}

function RuleRow({
  rule,
  index,
  count,
  busy,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  rule: AssignmentRule;
  index: number;
  count: number;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { t, tPlural } = useI18n();
  const conditionCount = countConditions(rule.conditions as FilterGroup);
  return (
    <li className={cn("group flex items-center gap-3 px-5 py-3.5", !rule.active && "opacity-60")}>
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

      <span className="shrink-0 text-caption-quiet tabular-nums text-subtle">
        #{index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">
          {rule.name}
        </p>
        <p className="truncate text-caption-quiet text-muted-foreground">
          {conditionCount === 0
            ? t("settings.assignmentRules.matchesAll")
            : tPlural("settings.assignmentRules.conditionCount", conditionCount)}
          {" → "}
          {targetLabel(rule, t)}
          {takeoverHint(rule, t)}
        </p>
      </div>

      <Switch
        checked={rule.active}
        onCheckedChange={onToggle}
        disabled={busy}
        aria-label={rule.active ? t("settings.assignmentRules.deactivate") : t("settings.assignmentRules.activate")}
      />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onEdit}
        aria-label={t("settings.assignmentRules.edit", { name: rule.name })}
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
            aria-label={t("settings.assignmentRules.delete", { name: rule.name })}
            className="h-7 w-7 shrink-0 text-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
                {t("settings.assignmentRules.deleteTitle", { name: rule.name })}
              </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.assignmentRules.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-white hover:bg-destructive"
            >
              {t("settings.assignmentRules.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function AssignmentRulesSettings() {
  const { t, formatNumber } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<AssignmentRuleTriggerEvent>("deal_added");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AssignmentRule | null>(null);

  const { data, isLoading, isError } = useAdminListAssignmentRules({
    query: { queryKey: getAdminListAssignmentRulesQueryKey() },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getAdminListAssignmentRulesQueryKey(),
    });
  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });

  const update = useUpdateAssignmentRule({
    mutation: { onSuccess: invalidate, onError },
  });
  const remove = useDeleteAssignmentRule({
    mutation: { onSuccess: invalidate, onError },
  });
  const reorder = useReorderAssignmentRules({
    mutation: { onSuccess: invalidate, onError },
  });
  const busy = update.isPending || remove.isPending || reorder.isPending;

  // The list arrives ordered by event then priority; split it per tab.
  const byEvent = useMemo(() => {
    const map: Record<AssignmentRuleTriggerEvent, AssignmentRule[]> = {
      deal_added: [],
      deal_updated: [],
    };
    for (const r of data?.rules ?? []) map[r.triggerEvent].push(r);
    return map;
  }, [data]);

  const rules = byEvent[tab];

  const move = (index: number, dir: -1 | 1) => {
    const next = [...rules];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate({
      data: { triggerEvent: tab, orderedIds: next.map((r) => r.id) },
    });
  };

  const openCreate = () => {
    setEditing(null);
    setWizardOpen(true);
  };
  const openEdit = (rule: AssignmentRule) => {
    setEditing(rule);
    setWizardOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-5">
        <h1 className="text-heading-sm text-foreground">
          {t("settings.nav.assignmentRules")}
        </h1>
        <p className="mt-1 text-body-quiet text-muted-foreground">
          {t("settings.assignmentRules.subtitle")}
        </p>
      </header>

      <SectionCard
        title={t("settings.assignmentRules.rules")}
        description={t("settings.assignmentRules.cardDescription")}
        actions={
          <Button
            size="sm"
            onClick={openCreate}
            className="h-8 bg-primary text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="me-1 h-3.5 w-3.5" /> {t("settings.assignmentRules.rule")}
          </Button>
        }
      >
        <div className="border-b border-border px-5 py-3">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as AssignmentRuleTriggerEvent)}
          >
            <TabsList>
              {EVENT_TABS.map((eventTab) => (
                <TabsTrigger key={eventTab.id} value={eventTab.id}>
                  {t(eventTab.labelKey)}
                  {byEvent[eventTab.id].length > 0 && (
                    <span className="ms-1.5 text-caption-quiet tabular-nums text-subtle">
                      {formatNumber(byEvent[eventTab.id].length)}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-body-quiet text-subtle">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("settings.assignmentRules.loading")}
          </div>
        ) : isError || !data ? (
          <div className="px-5 py-10 text-center text-body-quiet text-destructive">
            {t("settings.assignmentRules.loadFailed")}
          </div>
        ) : rules.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Workflow className="mx-auto mb-2 h-6 w-6 text-subtle" />
            <p className="text-body-quiet text-muted-foreground">
              {t("settings.assignmentRules.empty", {
                trigger: t(
                  EVENT_TABS.find((e) => e.id === tab)?.labelKey ??
                    "settings.assignmentRules.rule",
                ),
              })}
            </p>
            <p className="mt-1 text-caption-quiet text-subtle">
              {t("settings.assignmentRules.emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rules.map((rule, i) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={rules.length}
                busy={busy}
                onToggle={() =>
                  update.mutate({
                    id: rule.id,
                    data: { active: !rule.active },
                  })
                }
                onEdit={() => openEdit(rule)}
                onDelete={() => remove.mutate({ id: rule.id })}
                onMove={(dir) => move(i, dir)}
              />
            ))}
          </ul>
        )}

        <p className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-subtle">
          {t("settings.assignmentRules.footnote")}
        </p>
      </SectionCard>

      <AssignmentRuleWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editingRule={editing}
      />
    </div>
  );
}
