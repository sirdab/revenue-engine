import { useEffect, useRef, useState } from "react";
import {
  useListPipelines,
  getListPipelinesQueryKey,
  useListStages,
  getListStagesQueryKey,
  useListDealOwners,
  getListDealOwnersQueryKey,
  useCreateAutomation,
  useUpdateAutomation,
  getAdminListAutomationsQueryKey,
  useListAutomationTemplates,
  getListAutomationTemplatesQueryKey,
  useCreateAutomationTemplate,
  useUpdateAutomationTemplate,
  useDeleteAutomationTemplate,
  useListSlackChannels,
  getListSlackChannelsQueryKey,
  useTestAutomationMessage,
  useGetAutomationChips,
  getGetAutomationChipsQueryKey,
  useUpdateAutomationChips,
} from "@workspace/api-client-react";
import type {
  Automation,
  AutomationActionConfig,
  MessageChip,
  MessageChipConfig,
  AutomationActionType,
  AutomationTriggerEvent,
  AutomationTemplate,
  AssignmentRuleConditionGroup,
} from "@workspace/api-client-react";
import {
  EMPTY_FILTER,
  RULE_FILTER_FIELDS,
  countConditions,
  type FilterGroup,
} from "@workspace/deals-filter";
import {
  TEMPLATE_FIELDS,
  DEFAULT_MESSAGE_CHIPS,
} from "@workspace/automation-placeholders";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Plus, Send, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GroupEditor,
  type BuilderCtx,
} from "@/components/deals/deals-filter-builder";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n/i18n";

// 4-step wizard to create/edit a deal automation:
//   1. trigger event    2. conditions (reused deals-filter GroupEditor)
//   3. action + config  4. name + save
// Creating a new automation opens on a template gallery first (skippable).
// The Slack message field uses friendly field-chips + a live preview so a
// non-technical user never types raw {{deal.title}} placeholders.

const STEPS = [
  { id: "trigger", label: "settings.automations.wizard.step.trigger" },
  { id: "conditions", label: "settings.automations.wizard.step.conditions" },
  { id: "action", label: "settings.automations.wizard.step.action" },
  { id: "name", label: "settings.automations.wizard.step.name" },
] as const satisfies readonly { id: string; label: MessageKey }[];
type StepId = (typeof STEPS)[number]["id"];

const DEAL_OWNER = "__deal_owner__";
const AUTO_ASSIGN = "__auto__";
const FIRST_STAGE = "__first_stage__";

// Labels are message keys, translated at render; `value` is the API enum.
const ACTIVITY_TYPES: { value: string; label: MessageKey; noun: MessageKey }[] = [
  { value: "call", label: "dealActivity.type.call", noun: "settings.automations.activityNoun.call" },
  { value: "meeting", label: "dealActivity.type.meeting", noun: "settings.automations.activityNoun.meeting" },
  { value: "email", label: "dealActivity.type.email", noun: "settings.automations.activityNoun.email" },
  { value: "task", label: "dealActivity.type.task", noun: "settings.automations.activityNoun.task" },
  { value: "deadline", label: "dealActivity.type.deadline", noun: "settings.automations.activityNoun.deadline" },
  { value: "whatsapp", label: "dealActivity.type.whatsapp", noun: "settings.automations.activityNoun.whatsapp" },
];

// ---- Message field-chips + live preview -----------------------------------
// A chip inserts a raw {{scope.field}} token, but the user only ever sees the
// friendly label (and its Arabic equivalent). The chip defaults and the field
// whitelist come from @workspace/automation-placeholders — the same source the
// server validates and renders against, so the preview can't drift from it.
// These are the fallback chips shown while the org config loads.
const DEFAULT_DEAL_CHIPS: MessageChip[] = DEFAULT_MESSAGE_CHIPS.deal;

// Sample values the preview + "send test" render against.
const SAMPLE_SCOPES: Record<string, Record<string, unknown>> = {
  deal: {
    id: 42,
    title: "Acme Corp - Annual plan",
    value: 90000,
    currency: "USD",
    status: "open",
    stageId: 3,
    pipelineId: 1,
    owner: "Alex Morgan",
    stage: "Negotiation",
    pipeline: "Sales",
    organization: "Acme Corp",
  },
};
// Mirror of renderAutomationTemplate in api-server/src/lib/slack.ts (validates
// against the shared TEMPLATE_FIELDS whitelist).
function renderTemplate(template: string): string {
  return template.replace(
    /\{\{\s*(\w+)\.(\w+)\s*\}\}/g,
    (_, scope: string, field: string) => {
      if (!TEMPLATE_FIELDS[scope]?.includes(field)) return "";
      const v = SAMPLE_SCOPES[scope]?.[field];
      if (v == null) return "";
      // Display-only polish: format big sample numbers with separators.
      return typeof v === "number" && Math.abs(v) >= 1000
        ? v.toLocaleString("en-US")
        : String(v);
    },
  );
}

// ---- Built-in starter templates (bilingual, always present) ---------------
type Builtin = {
  key: string;
  emoji: string;
  name: MessageKey;
  description: MessageKey;
  triggerEvent: AutomationTriggerEvent;
  conditions: FilterGroup;
  /** Defaults to send_slack_message — every starter was Slack before. */
  actionType?: AutomationActionType;
  /** Only read for the Slack action; in-app notifications have no destination. */
  destination:
    | { kind: "channel"; channel: string }
    | { kind: "deal_owner" }
    | { kind: "user" };
  /** Pre-filled message; translated into the UI language when applied. */
  message: MessageKey;
};

const STATUS_WON_CONDITION = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "won" }],
} as unknown as FilterGroup;
const BUILTIN_TEMPLATES: Builtin[] = [
  {
    key: "celebrate-won",
    emoji: "🎉",
    name: "settings.automations.wizard.builtin.celebrateWon.name",
    description: "settings.automations.wizard.builtin.celebrateWon.description",
    triggerEvent: "deal_updated",
    conditions: STATUS_WON_CONDITION,
    destination: { kind: "channel", channel: "" },
    message: "settings.automations.wizard.builtin.celebrateWon.message",
  },
  {
    key: "new-lead",
    emoji: "📥",
    name: "settings.automations.wizard.builtin.newLead.name",
    description: "settings.automations.wizard.builtin.newLead.description",
    triggerEvent: "deal_added",
    conditions: structuredClone(EMPTY_FILTER),
    destination: { kind: "deal_owner" },
    message: "settings.automations.wizard.builtin.newLead.message",
  },
];

export function AutomationWizard({
  open,
  onOpenChange,
  editingAutomation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAutomation?: Automation | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t, locale } = useI18n();

  const [showGallery, setShowGallery] = useState(false);
  // Bilingual data (chip labels) follows the UI language.
  const lang = locale;
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  // Non-null = the wizard is editing this saved template, not an automation.
  const [editingTemplate, setEditingTemplate] =
    useState<AutomationTemplate | null>(null);

  const [step, setStep] = useState<StepId>("trigger");
  const [event, setEvent] = useState<AutomationTriggerEvent>("deal_added");
  const [conditions, setConditions] = useState<FilterGroup>(() =>
    structuredClone(EMPTY_FILTER),
  );
  const [actionType, setActionType] =
    useState<AutomationActionType>("create_activity");
  // create_activity config
  const [subject, setSubject] = useState("");
  const [activityType, setActivityType] = useState("call");
  const [dueInDays, setDueInDays] = useState(1);
  const [assignee, setAssignee] = useState<string>(DEAL_OWNER);
  // create_deal config
  const [pipelineId, setPipelineId] = useState<number | null>(null);
  const [stageChoice, setStageChoice] = useState<string>(FIRST_STAGE);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [owner, setOwner] = useState<string>(DEAL_OWNER);
  // call_webhook config
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState("POST");
  const [webhookIncludeDeal, setWebhookIncludeDeal] = useState(true);
  const [webhookSecretHeader, setWebhookSecretHeader] = useState("");
  // send_slack_message config
  const [slackDestType, setSlackDestType] = useState<
    "channel" | "deal_owner" | "user"
  >("channel");
  const [slackChannel, setSlackChannel] = useState("");
  const [slackUser, setSlackUser] = useState<string>("");
  const [slackMessage, setSlackMessage] = useState("");
  const [name, setName] = useState("");

  // Message block rows: slackMessage stays one string; rows = split("\n").
  const msgRowRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [msgFocus, setMsgFocus] = useState(0);

  // "Customize fields" — org-wide chip editor (add / edit / delete chips).
  const [manageChips, setManageChips] = useState(false);
  const [chipDraft, setChipDraft] = useState<MessageChipConfig | null>(null);
  const [chipEditIndex, setChipEditIndex] = useState<number | null>(null);
  const [chipLabel, setChipLabel] = useState("");
  // The name field edits the label of the UI language; the other is carried.
  const [chipLabelAr, setChipLabelAr] = useState("");
  const [chipInsertText, setChipInsertText] = useState("");

  // Populate every per-action field from a saved config (shared by edit-load
  // and template-apply).
  const populateFromConfig = (cfg: AutomationActionConfig) => {
    setSubject(cfg.subject ?? "");
    setActivityType(cfg.activityType ?? "call");
    setDueInDays(cfg.dueInDays ?? 1);
    setAssignee(
      cfg.assignee?.kind === "user" && cfg.assignee.userId != null
        ? String(cfg.assignee.userId)
        : DEAL_OWNER,
    );
    setPipelineId(cfg.pipelineId ?? null);
    setStageChoice(cfg.stageId != null ? String(cfg.stageId) : FIRST_STAGE);
    setTitleTemplate(cfg.titleTemplate ?? "");
    setOwner(
      cfg.owner?.kind === "user" && cfg.owner.userId != null
        ? String(cfg.owner.userId)
        : cfg.owner?.kind === "auto"
          ? AUTO_ASSIGN
          : DEAL_OWNER,
    );
    setWebhookUrl(cfg.url ?? "");
    setWebhookMethod(cfg.method ?? "POST");
    setWebhookIncludeDeal(cfg.includeDeal ?? true);
    setWebhookSecretHeader(cfg.secretHeaderName ?? "");
    setSlackDestType(cfg.destination?.kind ?? "channel");
    setSlackChannel(
      cfg.destination?.kind === "channel" ? (cfg.destination.channel ?? "") : "",
    );
    setSlackUser(
      cfg.destination?.kind === "user" && cfg.destination.userId != null
        ? String(cfg.destination.userId)
        : "",
    );
    setSlackMessage(cfg.message ?? "");
  };

  // Load a whole automation/template shape into the form.
  const loadShape = (shape: {
    triggerEvent: AutomationTriggerEvent;
    conditions: unknown;
    actionType: AutomationActionType;
    actionConfig: unknown;
  }) => {
    setEvent(shape.triggerEvent);
    setConditions(structuredClone(shape.conditions) as FilterGroup);
    setActionType(shape.actionType);
    populateFromConfig(shape.actionConfig as AutomationActionConfig);
  };

  // Reset the form whenever the dialog opens (fresh create, or pre-filled edit).
  useEffect(() => {
    if (!open) return;
    setSaveAsTemplate(false);
    setEditingTemplate(null);
    setManageChips(false);
    setChipDraft(null);
    setChipEditIndex(null);
    if (editingAutomation) {
      setShowGallery(false);
      setStep("trigger");
      loadShape(editingAutomation);
      setName(editingAutomation.name);
    } else {
      setShowGallery(true);
      setStep("trigger");
      setEvent("deal_added");
      setConditions(structuredClone(EMPTY_FILTER));
      setActionType("create_activity");
      setSubject("");
      setActivityType("call");
      setDueInDays(1);
      setAssignee(DEAL_OWNER);
      setPipelineId(null);
      setStageChoice(FIRST_STAGE);
      setTitleTemplate("");
      setOwner(DEAL_OWNER);
      setWebhookUrl("");
      setWebhookMethod("POST");
      setWebhookIncludeDeal(true);
      setWebhookSecretHeader("");
      setSlackDestType("channel");
      setSlackChannel("");
      setSlackUser("");
      setSlackMessage("");
      setName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingAutomation]);

  // Only fetch picker data once the dialog is open.
  const { data: pipelines } = useListPipelines({
    query: { queryKey: getListPipelinesQueryKey(), enabled: open },
  });
  const { data: stages } = useListStages(undefined, {
    query: { queryKey: getListStagesQueryKey(), enabled: open },
  });
  const { data: owners } = useListDealOwners({
    query: { queryKey: getListDealOwnersQueryKey(), enabled: open },
  });
  const { data: templateData } = useListAutomationTemplates({
    query: { queryKey: getListAutomationTemplatesQueryKey(), enabled: open },
  });
  const { data: channelData } = useListSlackChannels({
    query: {
      queryKey: getListSlackChannelsQueryKey(),
      enabled: open && actionType === "send_slack_message",
    },
  });
  const { data: chipData } = useGetAutomationChips({
    query: { queryKey: getGetAutomationChipsQueryKey(), enabled: open },
  });
  const chipConfig: MessageChipConfig = chipData ?? { deal: DEFAULT_DEAL_CHIPS };
  const savedTemplates = templateData?.templates ?? [];
  const slackChannelsAvailable = channelData?.available ?? false;
  const slackChannelItems = (channelData?.channels ?? []).map((c) => ({
    value: c.name,
    label:
      c.isMember
        ? (c.isPrivate ? "🔒 " : "#") + c.name
        : t("settings.automations.wizard.channelNeedsApp", {
            channel: (c.isPrivate ? "🔒 " : "#") + c.name,
          }),
  }));

  // Automations evaluate in memory against DealFacts — restrict the picker to
  // the fields that evaluator supports (list-only fields fail on save).
  const ctx: BuilderCtx = {
    stages: stages ?? [],
    users: owners ?? [],
    pipelines: pipelines ?? [],
    fields: RULE_FILTER_FIELDS,
  };
  const pipelineStages = (stages ?? []).filter(
    (s) => s.pipelineId === pipelineId,
  );
  const userItems = (owners ?? []).map((o) => ({
    value: String(o.id),
    label: o.name,
  }));

  const onError = (err: unknown) =>
    toast({ title: errorMessage(err), variant: "destructive" });
  const create = useCreateAutomation({ mutation: { onError } });
  const update = useUpdateAutomation({ mutation: { onError } });
  const createTemplate = useCreateAutomationTemplate({ mutation: { onError } });
  const updateTemplate = useUpdateAutomationTemplate({ mutation: { onError } });
  const deleteTemplate = useDeleteAutomationTemplate({ mutation: { onError } });
  const testMessage = useTestAutomationMessage({ mutation: { onError } });
  const updateChips = useUpdateAutomationChips({ mutation: { onError } });
  const busy =
    create.isPending ||
    update.isPending ||
    createTemplate.isPending ||
    updateTemplate.isPending;

  const handleSaved = () => {
    queryClient.invalidateQueries({
      queryKey: getAdminListAutomationsQueryKey(),
    });
    onOpenChange(false);
  };

  const actionValid =
    actionType === "create_activity"
      ? subject.trim().length > 0
      : actionType === "create_deal"
        ? pipelineId != null
        : actionType === "send_slack_message"
          ? slackMessage.trim().length > 0 &&
            (slackDestType !== "user" || slackUser !== "")
          : actionType === "post_notification"
            ? // Shares the message editor with the Slack action, so it shares its
              // non-empty check. There is no destination to validate — the
              // record's owner IS the destination.
              slackMessage.trim().length > 0
            : /^https:\/\/.+/.test(webhookUrl.trim());

  const buildConfig = (): AutomationActionConfig =>
    actionType === "create_activity"
      ? {
          subject: subject.trim(),
          activityType: activityType as AutomationActionConfig["activityType"],
          dueInDays,
          assignee:
            assignee === DEAL_OWNER
              ? { kind: "deal_owner" }
              : { kind: "user", userId: Number(assignee) },
        }
      : actionType === "create_deal"
        ? {
            pipelineId: pipelineId as number,
            stageId: stageChoice === FIRST_STAGE ? null : Number(stageChoice),
            titleTemplate: titleTemplate.trim() || null,
            owner:
              owner === DEAL_OWNER
                ? { kind: "deal_owner" }
                : owner === AUTO_ASSIGN
                  ? { kind: "auto" }
                  : { kind: "user", userId: Number(owner) },
          }
        : actionType === "send_slack_message"
          ? {
              destination:
                slackDestType === "channel"
                  ? { kind: "channel", channel: slackChannel.trim() }
                  : slackDestType === "deal_owner"
                    ? { kind: "deal_owner" }
                    : { kind: "user", userId: Number(slackUser) },
              message: slackMessage.trim(),
            }
          : actionType === "post_notification"
            ? { message: slackMessage.trim() }
          : {
              url: webhookUrl.trim(),
              method: webhookMethod as "POST" | "PUT",
              includeDeal: webhookIncludeDeal,
              secretHeaderName: webhookSecretHeader.trim() || null,
            };

  // Apply a built-in starter into the wizard, then jump to the action step.
  const applyBuiltin = (tpl: Builtin) => {
    loadShape({
      triggerEvent: tpl.triggerEvent,
      conditions: tpl.conditions,
      actionType: tpl.actionType ?? "send_slack_message",
      actionConfig:
        (tpl.actionType ?? "send_slack_message") === "post_notification"
          ? { message: t(tpl.message) }
          : {
              destination: tpl.destination,
              message: t(tpl.message),
            },
    });
    setName(t(tpl.name));
    setShowGallery(false);
    setStep("action");
  };

  const applySaved = (tpl: AutomationTemplate) => {
    loadShape({
      triggerEvent: tpl.triggerEvent as AutomationTriggerEvent,
      conditions: tpl.conditions,
      actionType: tpl.actionType as AutomationActionType,
      actionConfig: tpl.actionConfig,
    });
    setName(tpl.name);
    setShowGallery(false);
    setStep("action");
  };

  const sendTest = () => {
    testMessage.mutate(
      {
        data: {
          triggerEvent: event,
          actionType,
          actionConfig: buildConfig(),
        },
      },
      {
        onSuccess: (res) =>
          toast({
            title: res.delivered
              ? t("settings.automations.wizard.toast.testSent")
              : t("settings.automations.wizard.toast.testNotSent"),
            description: res.detail,
            variant: res.delivered ? undefined : "destructive",
          }),
      },
    );
  };

  const templatePayload = () => ({
    name: name.trim(),
    description: editingTemplate?.description ?? "",
    emoji: editingTemplate?.emoji ?? null,
    triggerEvent: event,
    conditions: conditions as AssignmentRuleConditionGroup,
    actionType,
    actionConfig: buildConfig(),
  });

  const afterTemplateWrite = (title: string) => {
    toast({ title });
    queryClient.invalidateQueries({
      queryKey: getListAutomationTemplatesQueryKey(),
    });
    onOpenChange(false);
  };

  // "Save as template only" — store the setup for the team without creating
  // (or running) an automation.
  const saveTemplateOnly = () => {
    if (!actionValid) {
      setStep("action");
      return;
    }
    if (!name.trim()) return;
    createTemplate.mutate(
      { data: templatePayload() },
      {
        onSuccess: () =>
          afterTemplateWrite(t("settings.automations.wizard.toast.savedTemplateOnly")),
      },
    );
  };

  // Editing an existing saved template: overwrite it in place.
  const saveTemplateEdit = () => {
    if (!editingTemplate) return;
    if (!actionValid) {
      setStep("action");
      return;
    }
    if (!name.trim()) return;
    updateTemplate.mutate(
      { id: editingTemplate.id, data: templatePayload() },
      { onSuccess: () => afterTemplateWrite(t("settings.automations.wizard.toast.templateUpdated")) },
    );
  };

  const finishSave = () => {
    if (saveAsTemplate) {
      createTemplate.mutate(
        {
          data: {
            name: name.trim(),
            description: "",
            emoji: null,
            triggerEvent: event,
            conditions: conditions as AssignmentRuleConditionGroup,
            actionType,
            actionConfig: buildConfig(),
          },
        },
        {
          onSuccess: () => {
            toast({ title: t("settings.automations.wizard.toast.savedAsTemplate") });
            queryClient.invalidateQueries({
              queryKey: getListAutomationTemplatesQueryKey(),
            });
          },
        },
      );
    }
    handleSaved();
  };

  const save = () => {
    if (!actionValid) {
      setStep("action");
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
      actionType,
      actionConfig: buildConfig(),
    };
    if (editingAutomation) {
      update.mutate(
        { id: editingAutomation.id, data },
        { onSuccess: finishSave },
      );
    } else {
      create.mutate({ data }, { onSuccess: finishSave });
    }
  };

  const msgRows = slackMessage.split("\n");

  const setMsgRow = (i: number, v: string) => {
    const rows = slackMessage.split("\n");
    rows[i] = v.replace(/\n/g, " "); // one row = one line
    setSlackMessage(rows.join("\n"));
  };

  const addMsgRow = () => {
    const next = slackMessage + "\n";
    setSlackMessage(next);
    const idx = next.split("\n").length - 1;
    setMsgFocus(idx);
    requestAnimationFrame(() => msgRowRefs.current[idx]?.focus());
  };

  const deleteMsgRow = (i: number) => {
    const rows = slackMessage.split("\n");
    rows.splice(i, 1);
    setSlackMessage(rows.length ? rows.join("\n") : "");
    setMsgFocus((f) => Math.max(0, Math.min(f > i ? f - 1 : f, rows.length - 1)));
  };

  const insertToken = (token: string) => {
    const i = Math.min(msgFocus, msgRows.length - 1);
    const el = msgRowRefs.current[i];
    const row = msgRows[i] ?? "";
    const start = el?.selectionStart ?? row.length;
    const end = el?.selectionEnd ?? start;
    setMsgRow(i, row.slice(0, start) + token + row.slice(end));
    requestAnimationFrame(() => {
      const target = msgRowRefs.current[i];
      target?.focus();
      const pos = start + token.length;
      target?.setSelectionRange(pos, pos);
    });
  };

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const canAdvance = step === "action" ? actionValid : true;

  // One human sentence describing the whole automation (name step).
  const messagePreview = renderTemplate(slackMessage);
  const plainSentence = (() => {
    const condCount = countConditions(conditions);
    // An updated deal fires only on the change that makes it match (the
    // engine's entering rule), so say "starts matching", not "matches".
    const sentenceKey: MessageKey =
      event === "deal_added"
        ? condCount > 0
          ? "settings.automations.wizard.plain.addedMatch"
          : "settings.automations.wizard.plain.addedAny"
        : condCount > 0
          ? "settings.automations.wizard.plain.updatedMatch"
          : "settings.automations.wizard.plain.updatedAny";

    let action = "";
    let withMessage = false;
    if (actionType === "send_slack_message") {
      const ch = slackChannel.trim().replace(/^#/, "");
      action =
        slackDestType === "channel"
          ? ch
            ? t("settings.automations.wizard.plain.postChannel", { channel: ch })
            : t("settings.automations.wizard.plain.postDefault")
          : slackDestType === "deal_owner"
            ? t("settings.automations.wizard.plain.dmOwner")
            : t("settings.automations.wizard.plain.dmUser", {
                name:
                  userItems.find((u) => u.value === slackUser)?.label ??
                  t("settings.automations.wizard.plain.aTeammate"),
              });
      withMessage = true;
    } else if (actionType === "post_notification") {
      // "the team", not "subscribers": there is no opt-in any more, so naming
      // subscribers would send people looking for a switch that is gone.
      action = t("settings.automations.wizard.plain.alertTeam");
      withMessage = true;
    } else if (actionType === "create_activity") {
      const noun = ACTIVITY_TYPES.find((a) => a.value === activityType)?.noun;
      action = t("settings.automations.wizard.plain.createActivity", {
        subject: subject.trim() || "…",
        type: noun ? t(noun) : activityType,
      });
    } else if (actionType === "create_deal") {
      const p = (pipelines ?? []).find((x) => x.id === pipelineId)?.name;
      action = p
        ? t("settings.automations.wizard.plain.createDealIn", { pipeline: p })
        : t("settings.automations.wizard.plain.createDeal");
    } else {
      let host = webhookUrl.trim();
      try {
        host = new URL(webhookUrl.trim()).host || host;
      } catch {
        /* keep raw */
      }
      action = t("settings.automations.wizard.plain.callWebhook", {
        host: host || t("settings.automations.wizard.plain.yourWebhook"),
      });
    }
    if (withMessage && messagePreview.trim())
      action = t("settings.automations.wizard.plain.withMessage", {
        action,
        message: messagePreview,
      });
    return t(sentenceKey, { action });
  })();

  const activeChips = (manageChips && chipDraft ? chipDraft : chipConfig).deal;

  const resetChipForm = () => {
    setChipEditIndex(null);
    setChipLabel("");
    setChipLabelAr("");
    setChipInsertText("");
  };

  const chipFormInsert = chipInsertText.trim();
  const chipLabelShown = lang === "ar" ? chipLabelAr : chipLabel;
  const setChipLabelShown = lang === "ar" ? setChipLabelAr : setChipLabel;
  const chipFormValid =
    chipLabelShown.trim().length > 0 && chipFormInsert.length > 0;

  const applyChipForm = () => {
    if (!chipDraft || !chipFormValid) return;
    const next = structuredClone(chipDraft);
    const chip: MessageChip = {
      insert: chipFormInsert,
      label: chipLabel.trim() || chipLabelAr.trim(),
      labelAr: chipLabelAr.trim() || chipLabel.trim(),
    };
    if (chipEditIndex == null) next.deal.push(chip);
    else next.deal[chipEditIndex] = chip;
    setChipDraft(next);
    resetChipForm();
  };

  const saveChipConfig = () => {
    if (!chipDraft) return;
    updateChips.mutate(
      { data: chipDraft },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAutomationChipsQueryKey(),
          });
          toast({ title: t("settings.automations.wizard.toast.fieldsUpdated") });
          setManageChips(false);
          setChipDraft(null);
          resetChipForm();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingTemplate
              ? t("settings.automations.wizard.title.editTemplate")
              : editingAutomation
                ? t("settings.automations.wizard.title.editAutomation")
                : showGallery
                  ? t("settings.automations.wizard.title.start")
                  : t("settings.automations.wizard.title.new")}
          </DialogTitle>
          <DialogDescription>
            {showGallery
              ? t("settings.automations.wizard.description.gallery")
              : t("settings.automations.wizard.description.wizard")}
          </DialogDescription>
        </DialogHeader>

        {showGallery ? (
          <div className="space-y-4">
            <div className="grid max-h-[22rem] gap-2.5 overflow-y-auto pe-1 sm:grid-cols-2">
              {BUILTIN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => applyBuiltin(tpl)}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 text-start transition-colors hover:border-btn-border-hover hover:bg-gray-alpha-50"
                >
                  <span className="text-heading-sm">{tpl.emoji}</span>
                  <span className="text-body font-semibold text-foreground">
                    {t(tpl.name)}
                  </span>
                  <span className="text-caption-quiet text-muted-foreground">
                    {t(tpl.description)}
                  </span>
                </button>
              ))}

              {savedTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="group relative flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:border-btn-border-hover hover:bg-gray-alpha-50"
                >
                  <button
                    type="button"
                    onClick={() => applySaved(tpl)}
                    className="flex flex-col gap-1 text-start"
                  >
                    <span className="text-heading-sm">{tpl.emoji || "⚙️"}</span>
                    <span dir="auto" className="text-body font-semibold text-foreground">
                      {tpl.name}
                    </span>
                    <span dir="auto" className="text-caption-quiet text-muted-foreground">
                      {tpl.description || t("settings.automations.wizard.teamTemplate")}
                    </span>
                    {tpl.createdByName && (
                      <span className="text-[11px] text-subtle">
                        {t("settings.automations.wizard.savedBy", {
                          name: tpl.createdByName,
                        })}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t("settings.assignmentRules.edit", { name: tpl.name })}
                    onClick={() => {
                      applySaved(tpl);
                      setEditingTemplate(tpl);
                      setStep("trigger");
                    }}
                    className="absolute end-8 top-2 rounded-md p-1 text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("settings.assignmentRules.delete", { name: tpl.name })}
                        disabled={deleteTemplate.isPending}
                        className="absolute end-2 top-2 rounded-md p-1 text-subtle opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("settings.automations.wizard.deleteTemplateTitle", {
                            name: tpl.name,
                          })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.automations.wizard.deleteTemplateDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            deleteTemplate.mutate(
                              { id: tpl.id },
                              {
                                onSuccess: () =>
                                  queryClient.invalidateQueries({
                                    queryKey:
                                      getListAutomationTemplatesQueryKey(),
                                  }),
                              },
                            )
                          }
                          className="bg-destructive text-white hover:bg-destructive"
                        >
                          {t("settings.automations.wizard.deleteTemplate")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowGallery(false)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input p-3 text-body text-muted-foreground hover:bg-gray-alpha-50"
            >
              <Plus className="h-4 w-4" /> {t("settings.automations.wizard.startFromScratch")}
            </button>
          </div>
        ) : (
          <>
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
                      i === stepIdx
                        ? "font-medium text-foreground"
                        : "text-subtle",
                    )}
                  >
                    {t(s.label)}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className="mx-1 h-px w-6 bg-gray-200" />
                  )}
                </li>
              ))}
            </ol>

            <div className="min-h-[16rem] py-2">
              {step === "trigger" && (
                <div className="space-y-4">
                  <Label className="text-caption-quiet text-muted-foreground">
                    {t("settings.automations.wizard.triggerEvent")}
                  </Label>
                  <RadioGroup
                    value={event}
                    onValueChange={(v) => setEvent(v as AutomationTriggerEvent)}
                    className="mt-2 space-y-2"
                  >
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                      <RadioGroupItem value="deal_added" className="mt-0.5" />
                      <span>
                        <span className="block text-body text-foreground">
                          {t("settings.automations.wizard.trigger.added")}
                        </span>
                        <span className="block text-caption-quiet text-muted-foreground">
                          {t("settings.automations.wizard.trigger.addedHint")}
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                      <RadioGroupItem value="deal_updated" className="mt-0.5" />
                      <span>
                        <span className="block text-body text-foreground">
                          {t("settings.automations.wizard.trigger.updated")}
                        </span>
                        <span className="block text-caption-quiet text-muted-foreground">
                          {t("settings.automations.wizard.trigger.updatedHint")}
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>
              )}

              {step === "conditions" && (
                <div>
                  <Label className="text-caption-quiet text-muted-foreground">
                    {t("settings.automations.wizard.conditions")}
                  </Label>
                  <p className="mb-2 text-caption-quiet text-subtle">
                    {event === "deal_added"
                      ? t("settings.automations.wizard.conditionsHintAdded")
                      : t("settings.automations.wizard.conditionsHintUpdated")}
                  </p>
                  <GroupEditor
                    group={conditions}
                    onChange={setConditions}
                    depth={1}
                    ctx={ctx}
                  />
                </div>
              )}

              {step === "action" && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-caption-quiet text-muted-foreground">
                      {t("settings.automations.wizard.action")}
                    </Label>
                    <RadioGroup
                      value={actionType}
                      onValueChange={(v) =>
                        setActionType(v as AutomationActionType)
                      }
                      className="mt-2 grid gap-2 sm:grid-cols-2"
                    >
                      {/* Every action works on both deal triggers. */}
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                        <RadioGroupItem
                          value="create_activity"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-body text-foreground">
                            {t("settings.automations.wizard.action.createActivity")}
                          </span>
                          <span className="block text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.action.createActivityHint")}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                        <RadioGroupItem
                          value="create_deal"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-body text-foreground">
                            {t("settings.automations.wizard.action.createDeal")}
                          </span>
                          <span className="block text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.action.createDealHint")}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                        <RadioGroupItem
                          value="call_webhook"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-body text-foreground">
                            {t("settings.automations.wizard.action.callWebhook")}
                          </span>
                          <span className="block text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.action.callWebhookHint")}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                        <RadioGroupItem
                          value="send_slack_message"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-body text-foreground">
                            {t("settings.automations.wizard.action.slack")}
                          </span>
                          <span className="block text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.action.slackHint")}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-gray-alpha-50">
                        <RadioGroupItem
                          value="post_notification"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-body text-foreground">
                            {t("settings.automations.wizard.action.notification")}
                          </span>
                          <span className="block text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.action.notificationHint")}
                          </span>
                        </span>
                      </label>
                    </RadioGroup>
                  </div>

                  {actionType === "create_activity" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="automation-subject"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("common.subject")}
                        </Label>
                        <Input
                          id="automation-subject"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          dir="auto"
                          placeholder={t("settings.automations.wizard.subjectPlaceholder")}
                          maxLength={200}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("common.type")}
                        </Label>
                        <Combobox
                          items={ACTIVITY_TYPES.map((a) => ({
                            value: a.value,
                            label: t(a.label),
                          }))}
                          inModal
                          value={activityType}
                          onChange={(v) => v && setActivityType(v)}
                          placeholder={t("dealActivity.type.call")}
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="automation-due"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.dueInDays")}
                        </Label>
                        <Input
                          id="automation-due"
                          type="number"
                          min={0}
                          max={365}
                          value={dueInDays}
                          onChange={(e) =>
                            setDueInDays(
                              Math.max(
                                0,
                                Math.floor(Number(e.target.value) || 0),
                              ),
                            )
                          }
                          className="mt-1"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("settings.automations.wizard.assignedTo")}
                        </Label>
                        <Combobox
                          items={[
                            {
                              value: DEAL_OWNER,
                              label: t("settings.automations.wizard.dealOwner"),
                            },
                            ...userItems,
                          ]}
                          inModal
                          value={assignee}
                          onChange={(v) => setAssignee(v || DEAL_OWNER)}
                          placeholder={t("settings.automations.wizard.dealOwner")}
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                    </div>
                  )}
                  {actionType === "create_deal" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("common.pipeline")}
                        </Label>
                        <Combobox
                          items={(pipelines ?? []).map((p) => ({
                            value: String(p.id),
                            label: p.name,
                          }))}
                          inModal
                          value={pipelineId == null ? "" : String(pipelineId)}
                          onChange={(v) => {
                            setPipelineId(v ? Number(v) : null);
                            setStageChoice(FIRST_STAGE);
                          }}
                          placeholder={t("settings.automations.wizard.selectPipeline")}
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div>
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("common.stage")}
                        </Label>
                        <Combobox
                          items={[
                            {
                              value: FIRST_STAGE,
                              label: t("settings.automations.wizard.firstStage"),
                            },
                            ...pipelineStages.map((s) => ({
                              value: String(s.id),
                              label: s.name,
                            })),
                          ]}
                          inModal
                          value={stageChoice}
                          onChange={(v) => setStageChoice(v || FIRST_STAGE)}
                          placeholder={t("settings.automations.wizard.firstStage")}
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="automation-title"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.titleTemplate")}
                        </Label>
                        <Input
                          id="automation-title"
                          value={titleTemplate}
                          onChange={(e) => setTitleTemplate(e.target.value)}
                          placeholder={t("settings.automations.wizard.titleTemplatePlaceholder")}
                          dir="auto"
                          maxLength={300}
                          className="mt-1"
                        />
                        <p className="mt-1 text-caption-quiet text-subtle">
                          {t("settings.automations.wizard.titleTemplateHint", {
                            token: "{title}",
                          })}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("common.owner")}
                        </Label>
                        <Combobox
                          items={[
                            {
                              value: DEAL_OWNER,
                              label: t("settings.automations.wizard.ownerSameAsSource"),
                            },
                            {
                              value: AUTO_ASSIGN,
                              label: t("settings.automations.wizard.autoAssign"),
                            },
                            ...userItems,
                          ]}
                          inModal
                          value={owner}
                          onChange={(v) => setOwner(v || DEAL_OWNER)}
                          placeholder={t("settings.automations.wizard.dealOwner")}
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                    </div>
                  )}
                  {actionType === "call_webhook" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="webhook-url"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.webhookUrl")}
                        </Label>
                        <Input
                          id="webhook-url"
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          placeholder="https://example.com/hooks/deal"
                          dir="ltr"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("settings.automations.wizard.method")}
                        </Label>
                        <Combobox
                          items={[
                            { value: "POST", label: "POST" },
                            { value: "PUT", label: "PUT" },
                          ]}
                          inModal
                          value={webhookMethod}
                          onChange={(v) => v && setWebhookMethod(v)}
                          placeholder="POST"
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <Switch
                          id="webhook-include-deal"
                          checked={webhookIncludeDeal}
                          onCheckedChange={setWebhookIncludeDeal}
                        />
                        <Label
                          htmlFor="webhook-include-deal"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.includeDeal")}
                        </Label>
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="webhook-secret-header"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.secretHeader")}
                        </Label>
                        <Input
                          id="webhook-secret-header"
                          value={webhookSecretHeader}
                          onChange={(e) =>
                            setWebhookSecretHeader(e.target.value)
                          }
                          placeholder="X-Webhook-Secret"
                          dir="ltr"
                          className="mt-1"
                        />
                        <p className="mt-1 text-caption-quiet text-subtle">
                          {t("settings.automations.wizard.secretHeaderHint")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Slack and in-app notifications share this whole block: the
                      message editor, the field chips and the live preview are
                      identical. Only the destination controls are Slack-specific
                      — an in-app notification goes to the record's owner, so
                      there is nothing to choose. */}
                  {(actionType === "send_slack_message" ||
                    actionType === "post_notification") && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div
                        className={cn(
                          actionType === "post_notification" && "hidden",
                        )}
                      >
                        <Label className="text-caption-quiet text-muted-foreground">
                          {t("settings.automations.wizard.sendTo")}
                        </Label>
                        <Select
                          value={slackDestType}
                          onValueChange={(v) =>
                            setSlackDestType(
                              v as "channel" | "deal_owner" | "user",
                            )
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="channel">
                              {t("settings.automations.wizard.dest.channel")}
                            </SelectItem>
                            <SelectItem value="deal_owner">
                              {t("settings.automations.wizard.dest.dealOwner")}
                            </SelectItem>
                            <SelectItem value="user">
                              {t("settings.automations.wizard.dest.user")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {actionType === "send_slack_message" &&
                        slackDestType === "channel" && (
                        <div>
                          <Label className="text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.channel")}
                          </Label>
                          {slackChannelsAvailable ? (
                            <Combobox
                              inModal
                              items={slackChannelItems}
                              value={slackChannel}
                              onChange={(v) => setSlackChannel(v || "")}
                              placeholder={t("settings.automations.wizard.pickChannel")}
                              triggerClassName="mt-1 h-9 w-full"
                            />
                          ) : (
                            <Input
                              id="slack-channel"
                              value={slackChannel}
                              onChange={(e) => setSlackChannel(e.target.value)}
                              placeholder="#sales-wins"
                              dir="ltr"
                              className="mt-1"
                            />
                          )}
                          <p className="mt-1 text-caption-quiet text-subtle">
                            {slackChannelsAvailable
                              ? t("settings.automations.wizard.channelHintList")
                              : t("settings.automations.wizard.channelHintManual")}
                          </p>
                        </div>
                      )}

                      {actionType === "send_slack_message" &&
                        slackDestType === "user" && (
                        <div>
                          <Label className="text-caption-quiet text-muted-foreground">
                            {t("settings.automations.wizard.recipient")}
                          </Label>
                          <Combobox
                            items={userItems}
                            inModal
                            value={slackUser}
                            onChange={(v) => setSlackUser(v || "")}
                            placeholder={t("settings.automations.wizard.pickTeammate")}
                            triggerClassName="mt-1 h-9 w-full"
                          />
                        </div>
                      )}

                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="slack-message"
                          className="text-caption-quiet text-muted-foreground"
                        >
                          {t("settings.automations.wizard.message")}
                        </Label>

                        {/* Field chips — click to insert, no typing braces */}
                        {!manageChips ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {activeChips.map((c) => (
                              <button
                                key={c.insert + c.label}
                                type="button"
                                onClick={() => insertToken(c.insert)}
                                className="rounded-md border border-border bg-card px-2 py-0.5 text-caption text-foreground hover:bg-gray-alpha-50"
                              >
                                + {lang === "ar" ? c.labelAr || c.label : c.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setChipDraft(structuredClone(chipConfig));
                                setManageChips(true);
                              }}
                              className="ms-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-subtle hover:bg-gray-alpha-100 hover:text-muted-foreground"
                            >
                              ⚙ {t("settings.automations.wizard.customizeFields")}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-1 rounded-lg border border-border bg-surface-whisper/60 p-3">
                            <p className="text-caption text-muted-foreground">
                              {t("settings.automations.wizard.customizeTitle")}
                            </p>
                            <p className="mt-0.5 text-[11px] text-subtle">
                              {t("settings.automations.wizard.customizeHint")}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {activeChips.map((c, i) => (
                                <span
                                  key={c.insert + c.label + i}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-caption",
                                    chipEditIndex === i
                                      ? "border-gray-alpha-400 bg-gray-alpha-100 text-foreground"
                                      : "border-transparent bg-brand-subtle text-brand-subtle-foreground",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setChipEditIndex(i);
                                      setChipLabel(c.label);
                                      setChipLabelAr(c.labelAr || c.label);
                                      setChipInsertText(c.insert);
                                    }}
                                  >
                                    {lang === "ar" ? c.labelAr || c.label : c.label}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={t("settings.automations.wizard.removeField")}
                                    onClick={() => {
                                      if (!chipDraft) return;
                                      const next = structuredClone(chipDraft);
                                      next.deal.splice(i, 1);
                                      setChipDraft(next);
                                      if (chipEditIndex === i) resetChipForm();
                                    }}
                                    className="text-brand hover:text-destructive"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <div>
                                <Label className="text-[11px] text-muted-foreground">
                                  {t("common.name")}
                                </Label>
                                <Input
                                  value={chipLabelShown}
                                  onChange={(e) => setChipLabelShown(e.target.value)}
                                  dir="auto"
                                  placeholder={t("settings.automations.wizard.chipNamePlaceholder")}
                                  maxLength={40}
                                  className="mt-1 h-8 text-caption-quiet"
                                />
                              </div>
                              <div>
                                <Label className="text-[11px] text-muted-foreground">
                                  {t("settings.automations.wizard.chipInserts")}
                                </Label>
                                <Input
                                  value={chipInsertText}
                                  onChange={(e) => setChipInsertText(e.target.value)}
                                  placeholder={t(
                                    "settings.automations.wizard.chipInsertsPlaceholder",
                                    { example: "{{deal.title}}" },
                                  )}
                                  maxLength={120}
                                  dir="auto"
                                  className="mt-1 h-8 font-mono text-caption-quiet"
                                />
                              </div>
                            </div>
                            <p className="mt-1.5 text-[10.5px] text-subtle">
                              {t("settings.automations.wizard.fieldsYouCanUse", {
                                fields: DEFAULT_DEAL_CHIPS.map((f) => f.insert).join("  "),
                              })}
                            </p>

                            <div className="mt-2 flex items-center justify-between">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!chipFormValid}
                                onClick={applyChipForm}
                              >
                                {chipEditIndex == null
                                  ? t("settings.automations.wizard.addField")
                                  : t("settings.automations.wizard.updateField")}
                              </Button>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setManageChips(false);
                                    setChipDraft(null);
                                    resetChipForm();
                                  }}
                                >
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={updateChips.isPending}
                                  onClick={saveChipConfig}
                                  className="bg-primary text-primary-foreground hover:bg-primary-hover"
                                >
                                  {updateChips.isPending && (
                                    <Loader2 className="me-1.5 h-3 w-3 animate-spin" />
                                  )}
                                  {t("settings.automations.wizard.saveFields")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-2 space-y-1.5">
                          {msgRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Input
                                id={i === 0 ? "slack-message" : undefined}
                                ref={(el) => {
                                  msgRowRefs.current[i] = el;
                                }}
                                value={row}
                                dir="auto"
                                onFocus={() => setMsgFocus(i)}
                                onChange={(e) => setMsgRow(i, e.target.value)}
                                placeholder={
                                  i === 0
                                    ? t("settings.automations.wizard.messagePlaceholder")
                                    : t("settings.automations.wizard.anotherLine")
                                }
                                className={cn(
                                  "flex-1",
                                  msgFocus === i && "border-gray-alpha-400",
                                )}
                              />
                              <button
                                type="button"
                                aria-label={t("settings.automations.wizard.deleteLine")}
                                disabled={msgRows.length === 1 && !row}
                                onClick={() => deleteMsgRow(i)}
                                className="rounded-md p-1.5 text-subtle transition-colors hover:text-destructive disabled:opacity-30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addMsgRow}
                            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-1.5 text-caption text-muted-foreground hover:bg-gray-alpha-50"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t("settings.automations.wizard.addLine")}
                          </button>
                        </div>

                        {/* Live preview against sample data */}
                        <div className="mt-2 rounded-md border-s-2 border-gray-alpha-300 bg-surface-whisper px-3 py-2">
                          <p className="text-caption text-brand">
                            {t("settings.automations.wizard.preview")}
                          </p>
                          <p
                            dir="auto"
                            className="mt-0.5 whitespace-pre-wrap text-body-quiet text-foreground"
                          >
                            {messagePreview.trim() ||
                              t("settings.automations.wizard.previewEmpty")}
                          </p>
                        </div>

                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!actionValid || testMessage.isPending}
                            onClick={sendTest}
                          >
                            {testMessage.isPending ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="me-1.5 h-3.5 w-3.5" />
                            )}
                            {t("settings.automations.wizard.sendTest")}
                          </Button>
                          <span className="ms-2 text-caption-quiet text-subtle">
                            {t("settings.automations.wizard.sendTestHint")}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === "name" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="automation-name"
                      className="text-caption-quiet text-muted-foreground"
                    >
                      {t("settings.automations.wizard.automationName")}
                    </Label>
                    <Input
                      id="automation-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && name.trim() && !busy && save()
                      }
                      placeholder={t("settings.automations.wizard.namePlaceholder")}
                      dir="auto"
                      maxLength={200}
                      autoFocus
                    />
                  </div>

                  {/* Plain-words confirmation */}
                  <div className="rounded-lg bg-warning-subtle px-4 py-3">
                    <p className="text-caption text-warning">
                      {t("settings.automations.wizard.inPlainWords")}
                    </p>
                    <p className="mt-1 text-body-quiet text-foreground">
                      {plainSentence}
                    </p>
                  </div>

                  {!editingTemplate && !editingAutomation && (
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <Switch
                        checked={saveAsTemplate}
                        onCheckedChange={setSaveAsTemplate}
                      />
                      <span className="text-body-quiet text-muted-foreground">
                        {t("settings.automations.wizard.alsoSaveTemplate")}
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {!showGallery && (
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                if (stepIdx > 0) setStep(STEPS[stepIdx - 1].id);
                else if (!editingAutomation) {
                  setEditingTemplate(null);
                  setShowGallery(true);
                }
              }}
              disabled={busy || (stepIdx === 0 && !!editingAutomation)}
            >
              {t("settings.automations.wizard.back")}
            </Button>
            {step === "name" ? (
              <div className="flex items-center gap-2">
                {!editingTemplate && !editingAutomation && (
                  <Button
                    variant="outline"
                    onClick={saveTemplateOnly}
                    disabled={!name.trim() || busy}
                  >
                    {t("settings.automations.wizard.saveTemplateOnly")}
                  </Button>
                )}
                <Button
                  onClick={editingTemplate ? saveTemplateEdit : save}
                  disabled={!name.trim() || busy}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover"
                >
                  {busy && (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {editingTemplate
                    ? t("settings.automations.wizard.saveTemplate")
                    : editingAutomation
                      ? t("settings.automations.wizard.saveChanges")
                      : t("settings.automations.wizard.createAutomation")}
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => canAdvance && setStep(STEPS[stepIdx + 1].id)}
                disabled={!canAdvance || busy}
                className="bg-primary text-primary-foreground hover:bg-primary-hover"
              >
                {t("common.next")}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
