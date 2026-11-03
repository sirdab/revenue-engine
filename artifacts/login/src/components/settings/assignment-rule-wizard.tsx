import { useEffect, useState } from "react";
import {
  useAdminListTeams,
  getAdminListTeamsQueryKey,
  useListPipelines,
  getListPipelinesQueryKey,
  useListStages,
  getListStagesQueryKey,
  useListDealOwners,
  getListDealOwnersQueryKey,
  useCreateAssignmentRule,
  useUpdateAssignmentRule,
  getAdminListAssignmentRulesQueryKey,
} from "@workspace/api-client-react";
import type {
  AssignmentRule,
  AssignmentRuleConditionGroup,
  AssignmentRuleTriggerEvent,
} from "@workspace/api-client-react";
import {
  EMPTY_FILTER,
  RULE_FILTER_FIELDS,
  type FilterGroup,
} from "@workspace/deals-filter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  GroupEditor,
  type BuilderCtx,
} from "@/components/deals/deals-filter-builder";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";

// 3-step wizard to create/edit an auto-assignment rule (Pipedrive parity):
//   1. entity (Deal, fixed) + trigger event
//   2. conditions (the reused deals-filter GroupEditor) + assignee target
//   3. name + save
// The conditions tree is the shared FilterGroup DSL — the same builder the Deals
// workspace uses — so a rule matches exactly what an admin would filter for. A
// round-robin target is "no specific assignee" (null); the server distributes to
// the least-loaded active member of the team.

const STEPS = [
  { id: "event", label: "Trigger" },
  { id: "conditions", label: "Conditions & assignee" },
  { id: "name", label: "Name" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

// Combobox sentinel for "no fixed assignee" (round-robin). Combobox values are
// strings; null (round-robin) maps to this sentinel and back.
const ROUND_ROBIN = "__round_robin__";

export function AssignmentRuleWizard({
  open,
  onOpenChange,
  editingRule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRule?: AssignmentRule | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<StepId>("event");
  const [event, setEvent] = useState<AssignmentRuleTriggerEvent>("deal_added");
  const [conditions, setConditions] = useState<FilterGroup>(() =>
    structuredClone(EMPTY_FILTER),
  );
  const [teamId, setTeamId] = useState<number | null>(null);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [takeoverOwned, setTakeoverOwned] = useState(false);
  const [name, setName] = useState("");

  // Reset the form whenever the dialog opens (fresh create, or pre-filled edit).
  useEffect(() => {
    if (!open) return;
    setStep("event");
    if (editingRule) {
      setEvent(editingRule.triggerEvent);
      setConditions(structuredClone(editingRule.conditions) as FilterGroup);
      setTeamId(editingRule.targetTeamId);
      setAssigneeId(editingRule.targetAssigneeId);
      setTakeoverOwned(editingRule.takeoverOwned ?? false);
      setName(editingRule.name);
    } else {
      setEvent("deal_added");
      setConditions(structuredClone(EMPTY_FILTER));
      setTeamId(null);
      setAssigneeId(null);
      setTakeoverOwned(false);
      setName("");
    }
  }, [open, editingRule]);

  // Only fetch the pickers' data once the dialog is open — a closed wizard
  // (the common case while browsing the rules list) fires no requests.
  const { data: teamsData } = useAdminListTeams({
    query: { queryKey: getAdminListTeamsQueryKey(), enabled: open },
  });
  const { data: pipelines } = useListPipelines({
    query: { queryKey: getListPipelinesQueryKey(), enabled: open },
  });
  const { data: stages } = useListStages(undefined, {
    query: { queryKey: getListStagesQueryKey(), enabled: open },
  });
  const { data: owners } = useListDealOwners({
    query: { queryKey: getListDealOwnersQueryKey(), enabled: open },
  });

  const teams = teamsData?.teams ?? [];
  const selectedTeam = teams.find((t) => t.id === teamId) ?? null;
  // Rules evaluate in memory against DealFacts — restrict the picker to the
  // fields that evaluator supports (list-only fields would be rejected on save).
  const ctx: BuilderCtx = {
    stages: stages ?? [],
    users: owners ?? [],
    pipelines: pipelines ?? [],
    fields: RULE_FILTER_FIELDS,
  };

  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });
  const create = useCreateAssignmentRule({ mutation: { onError } });
  const update = useUpdateAssignmentRule({ mutation: { onError } });
  const busy = create.isPending || update.isPending;

  const handleSaved = () => {
    queryClient.invalidateQueries({
      queryKey: getAdminListAssignmentRulesQueryKey(),
    });
    onOpenChange(false);
  };

  const save = () => {
    if (teamId == null) {
      toast({ title: "Pick a team to assign to.", variant: "destructive" });
      setStep("conditions");
      return;
    }
    if (!name.trim()) {
      setStep("name");
      return;
    }
    const data = {
      name: name.trim(),
      triggerEvent: event,
      conditions: conditions as AssignmentRuleConditionGroup,
      targetTeamId: teamId,
      targetAssigneeId: assigneeId,
      takeoverOwned: event === "deal_updated" ? takeoverOwned : false,
    };
    if (editingRule) {
      update.mutate({ id: editingRule.id, data }, { onSuccess: handleSaved });
    } else {
      create.mutate({ data }, { onSuccess: handleSaved });
    }
  };

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const canAdvance = step !== "conditions" || teamId != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingRule ? "Edit assignment rule" : "New assignment rule"}
          </DialogTitle>
          <DialogDescription>
            Route deals to a team or person automatically when they match these
            conditions.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <ol className="flex items-center gap-2 text-caption-quiet">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  i <= stepIdx
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-subtle",
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  i === stepIdx ? "font-medium text-foreground" : "text-subtle",
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="mx-1 h-px w-6 bg-gray-200" />
              )}
            </li>
          ))}
        </ol>

        <div className="min-h-[16rem] py-2">
          {step === "event" && (
            <div className="space-y-4">
              <div>
                <Label className="text-caption-quiet text-muted-foreground">Entity</Label>
                <p className="mt-1 text-body text-foreground">Deal</p>
                <p className="text-caption-quiet text-subtle">
                  Lead-entity rules aren&apos;t supported yet.
                </p>
              </div>
              <div>
                <Label className="text-caption-quiet text-muted-foreground">Trigger event</Label>
                <RadioGroup
                  value={event}
                  onValueChange={(v) =>
                    setEvent(v as AssignmentRuleTriggerEvent)
                  }
                  className="mt-2 space-y-2"
                >
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                    <RadioGroupItem value="deal_added" className="mt-0.5" />
                    <span>
                      <span className="block text-body text-foreground">
                        Deal added
                      </span>
                      <span className="block text-caption-quiet text-muted-foreground">
                        Assign when a new deal is created (including inbound
                        leads).
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                    <RadioGroupItem value="deal_updated" className="mt-0.5" />
                    <span>
                      <span className="block text-body text-foreground">
                        Deal updated
                      </span>
                      <span className="block text-caption-quiet text-muted-foreground">
                        Assign on a pipeline or stage change. Ownerless deals
                        only, unless the rule may take over owned deals (next
                        step).
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </div>
            </div>
          )}

          {step === "conditions" && (
            <div className="space-y-4">
              <div>
                <Label className="text-caption-quiet text-muted-foreground">
                  Assignment conditions
                </Label>
                <p className="mb-2 text-caption-quiet text-subtle">
                  The deal must match these to be routed by this rule. Leave
                  empty to match every deal of this trigger.
                </p>
                <GroupEditor
                  group={conditions}
                  onChange={setConditions}
                  depth={1}
                  ctx={ctx}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-caption-quiet text-muted-foreground">Team</Label>
                  <Combobox
                    items={teams.map((t) => ({
                      value: String(t.id),
                      label: t.name,
                    }))}
                    value={teamId == null ? "" : String(teamId)}
                    onChange={(v) => {
                      setTeamId(v ? Number(v) : null);
                      // Assignee must belong to the chosen team; reset on change.
                      setAssigneeId(null);
                    }}
                    placeholder="Select a team…"
                    triggerClassName="mt-1 h-9 w-full"
                  />
                </div>
                <div>
                  <Label className="text-caption-quiet text-muted-foreground">Assignee</Label>
                  <Combobox
                    items={[
                      {
                        value: ROUND_ROBIN,
                        label: "Round-robin (any active member)",
                      },
                      ...(selectedTeam?.members ?? []).map((m) => ({
                        value: String(m.id),
                        label: m.name,
                      })),
                    ]}
                    value={assigneeId == null ? ROUND_ROBIN : String(assigneeId)}
                    onChange={(v) =>
                      setAssigneeId(v === ROUND_ROBIN || !v ? null : Number(v))
                    }
                    placeholder="Round-robin (any active member)"
                    triggerClassName="mt-1 h-9 w-full"
                  />
                  {teamId == null && (
                    <p className="mt-1 text-caption-quiet text-subtle">
                      Pick a team first to choose a specific person.
                    </p>
                  )}
                </div>
              </div>

              {event === "deal_updated" && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                  <Switch
                    checked={takeoverOwned}
                    onCheckedChange={setTakeoverOwned}
                  />
                  <span>
                    <span className="block text-body text-foreground">
                      May take over owned deals
                    </span>
                    <span className="block text-caption-quiet text-muted-foreground">
                      Off (default): this rule only routes deals that have no
                      owner. On: when the pipeline or stage changes, this rule
                      reassigns the deal even if someone already owns it, use
                      for handovers like SDR → closers.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          {step === "name" && (
            <div className="space-y-2">
              <Label htmlFor="rule-name" className="text-caption-quiet text-muted-foreground">
                Rule name
              </Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
                placeholder="e.g. “Enterprise deals → Enterprise team”"
                maxLength={200}
                autoFocus
              />
              <p className="text-caption-quiet text-subtle">
                A clear name helps you recognize this rule in the list.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            onClick={() =>
              stepIdx > 0 && setStep(STEPS[stepIdx - 1].id)
            }
            disabled={stepIdx === 0 || busy}
          >
            Back
          </Button>
          {step === "name" ? (
            <Button
              onClick={save}
              disabled={!name.trim() || busy}
              className="bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              {busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              {editingRule ? "Save changes" : "Create rule"}
            </Button>
          ) : (
            <Button
              onClick={() => canAdvance && setStep(STEPS[stepIdx + 1].id)}
              disabled={!canAdvance || busy}
              className="bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
