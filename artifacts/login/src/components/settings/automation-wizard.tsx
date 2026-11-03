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

// 4-step wizard to create/edit a deal automation:
//   1. trigger event    2. conditions (reused deals-filter GroupEditor)
//   3. action + config  4. name + save
// Creating a new automation opens on a template gallery first (skippable).
// The Slack message field uses friendly field-chips + a live preview so a
// non-technical user never types raw {{deal.title}} placeholders.

const STEPS = [
  { id: "trigger", label: "Trigger" },
  { id: "conditions", label: "Conditions" },
  { id: "action", label: "Action" },
  { id: "name", label: "Name" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const DEAL_OWNER = "__deal_owner__";
const AUTO_ASSIGN = "__auto__";
const FIRST_STAGE = "__first_stage__";

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "task", label: "Task" },
  { value: "deadline", label: "Deadline" },
  { value: "whatsapp", label: "WhatsApp" },
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
    title: "Acme Foods - Annual Contract",
    value: 900000,
    currency: "SAR",
    status: "open",
    stageId: 3,
    pipelineId: 1,
    owner: "Omar Khalid",
    stage: "Negotiation",
    pipeline: "Sales",
    organization: "Acme Foods",
  },
  params: {
    days: 30,
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
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  triggerEvent: AutomationTriggerEvent;
  conditions: FilterGroup;
  /** Defaults to send_slack_message — every starter was Slack before. */
  actionType?: AutomationActionType;
  /** Only read for the Slack action; in-app notifications have no destination. */
  destination:
    | { kind: "channel"; channel: string }
    | { kind: "deal_owner" }
    | { kind: "user" };
  /** post_notification only: legacy per-person knobs; nothing tunes them now. */
  tunable?: ("days" | never)[];
  message: string;
  messageAr: string;
  /**
   * A full action config, for starters whose action is neither Slack nor an
   * in-app notification (the create-activity starter). Wins over destination
   * and message when present; `actionConfigAr` is its Arabic twin.
   */
  actionConfig?: AutomationActionConfig;
  actionConfigAr?: AutomationActionConfig;
};

const STATUS_WON_CONDITION = {
  combinator: "and",
  conditions: [{ field: "status", operator: "is", value: "won" }],
} as unknown as FilterGroup;

const BUILTIN_TEMPLATES: Builtin[] = [
  {
    key: "celebrate-won",
    emoji: "🎉",
    name: "Celebrate won deals",
    nameAr: "احتفل بالصفقات المكسوبة",
    description: "When a deal is won, post it to a channel.",
    descriptionAr: "عند كسب صفقة، انشرها في قناة.",
    triggerEvent: "deal_updated",
    conditions: STATUS_WON_CONDITION,
    destination: { kind: "channel", channel: "" },
    message: "🎉 {{deal.title}} won: {{deal.value}} {{deal.currency}}",
    messageAr: "🎉 تم كسب صفقة {{deal.title}}: {{deal.value}} {{deal.currency}}",
  },
  {
    key: "new-lead",
    emoji: "📥",
    name: "New lead alert",
    nameAr: "تنبيه صفقة جديدة",
    description: "When a deal is created, DM the owner.",
    descriptionAr: "عند إنشاء صفقة، أرسل رسالة خاصة لصاحبها.",
    triggerEvent: "deal_added",
    conditions: structuredClone(EMPTY_FILTER),
    destination: { kind: "deal_owner" },
    message: "📥 New deal assigned to you: {{deal.title}}",
    messageAr: "📥 تم تعيين صفقة جديدة لك: {{deal.title}}",
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

  const [showGallery, setShowGallery] = useState(false);
  // English only for now (Arabic shelved per founder) — `lang` is frozen so
  // the bilingual strings stay dormant; restore the header toggle to re-enable.
  const [lang] = useState<"en" | "ar">("en");
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
  const [chipLabelAr, setChipLabelAr] = useState(""); // carried, not shown
  const [chipInsertText, setChipInsertText] = useState("");
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);


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
  const chipConfig: MessageChipConfig = chipData ?? {
    deal: DEFAULT_DEAL_CHIPS,
  };
  const savedTemplates = templateData?.templates ?? [];
  const slackChannelsAvailable = channelData?.available ?? false;
  const slackChannelItems = (channelData?.channels ?? []).map((c) => ({
    value: c.name,
    label:
      (c.isPrivate ? "🔒 " : "#") +
      c.name +
      (c.isMember ? "" : " · add the Slack app to this channel first"),
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

  const conditionsPayload = (): AssignmentRuleConditionGroup =>
    conditions as AssignmentRuleConditionGroup;

  // Apply a built-in starter into the wizard, then jump to the action step.
  const applyBuiltin = (t: Builtin) => {
    loadShape({
      triggerEvent: t.triggerEvent,
      conditions: t.conditions,
      actionType: t.actionType ?? "send_slack_message",
      actionConfig: t.actionConfig
        ? lang === "ar"
          ? (t.actionConfigAr ?? t.actionConfig)
          : t.actionConfig
        : (t.actionType ?? "send_slack_message") === "post_notification"
          ? {
              message: lang === "ar" ? t.messageAr : t.message,
              ...(t.tunable ? { tunable: t.tunable } : {}),
            }
          : {
              destination: t.destination,
              message: lang === "ar" ? t.messageAr : t.message,
            },
    });
    setName(lang === "ar" ? t.nameAr : t.name);
    setShowGallery(false);
    setStep("action");
  };

  const applySaved = (t: AutomationTemplate) => {
    loadShape({
      triggerEvent: t.triggerEvent as AutomationTriggerEvent,
      conditions: t.conditions,
      actionType: t.actionType as AutomationActionType,
      actionConfig: t.actionConfig,
    });
    setName(t.name);
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
            title: res.delivered ? "Test sent" : "Test not sent",
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
    conditions: conditionsPayload(),
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
          afterTemplateWrite("Saved as a team template, no automation created"),
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
      { onSuccess: () => afterTemplateWrite("Template updated for the team") },
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
            conditions: conditionsPayload(),
            actionType,
            actionConfig: buildConfig(),
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Saved as a team template" });
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
      conditions: conditionsPayload(),
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
    const ar = lang === "ar";
    const triggerPart =
      event === "deal_added"
          ? ar
            ? "يتم فيها إنشاء صفقة"
            : "a deal is created"
          : ar
            ? "يتم فيها تحديث صفقة"
            : "a deal is updated";
    const condCount = countConditions(conditions);
    // An updated deal fires only on the change that makes it match (the
    // engine's entering rule), so say "starts matching", not "matches".
    const condPart =
      condCount > 0
        ? event === "deal_updated"
          ? ar
            ? " فتصبح مطابقة لشروطك"
            : " and starts matching your conditions"
          : ar
            ? " تطابق شروطك"
            : " that matches your conditions"
        : "";

    let actionPart = "";
    let tail = "";
    if (actionType === "send_slack_message") {
      const ch = slackChannel.trim().replace(/^#/, "");
      actionPart =
        slackDestType === "channel"
          ? ch
            ? ar
              ? `انشر في #${ch}`
              : `post to #${ch}`
            : ar
              ? "انشر في قناة الإعلانات الافتراضية"
              : "post to the default announcements channel"
          : slackDestType === "deal_owner"
            ? ar
              ? "أرسل رسالة خاصة لمالك الصفقة"
              : "DM the deal owner"
            : ar
              ? `أرسل رسالة خاصة لـ ${userItems.find((u) => u.value === slackUser)?.label ?? "زميل"}`
              : `DM ${userItems.find((u) => u.value === slackUser)?.label ?? "a teammate"}`;
      if (messagePreview.trim())
        tail = ar ? `: «${messagePreview}»` : `: “${messagePreview}”`;
    } else if (actionType === "post_notification") {
      // "the team", not "subscribers": there is no opt-in any more, so naming
      // subscribers would send people looking for a switch that is gone.
      actionPart = ar ? "أشعر الفريق داخل التطبيق" : "alert the team in the app";
      if (messagePreview.trim())
        tail = ar ? `: «${messagePreview}»` : `: “${messagePreview}”`;
    } else if (actionType === "create_activity") {
      actionPart = ar
        ? `أنشئ نشاطًا بعنوان «${subject.trim() || "…"}»`
        : `create a “${subject.trim() || "…"}” ${activityType} activity`;
    } else if (actionType === "create_deal") {
      const p = (pipelines ?? []).find((x) => x.id === pipelineId)?.name;
      actionPart = ar
        ? `أنشئ صفقة${p ? ` في ${p}` : ""}`
        : `create a deal${p ? ` in ${p}` : ""}`;
    } else {
      let host = webhookUrl.trim();
      try {
        host = new URL(webhookUrl.trim()).host || host;
      } catch {
        /* keep raw */
      }
      actionPart = ar
        ? `استدعِ ${host || "الرابط الخاص بك"}`
        : `call ${host || "your webhook"}`;
    }
    return ar
      ? `في كل مرة ${triggerPart}${condPart}، ${actionPart}${tail}.`
      : `Every time ${triggerPart}${condPart}, ${actionPart}${tail}.`;
  })();

  const chipScope = "deal" as const;
  const activeChips = (manageChips && chipDraft ? chipDraft : chipConfig)[
    chipScope
  ];

  const resetChipForm = () => {
    setChipEditIndex(null);
    setChipLabel("");
    setChipLabelAr("");
    setChipInsertText("");
  };

  const chipFormInsert = chipInsertText.trim();
  const chipFormValid = chipLabel.trim().length > 0 && chipFormInsert.length > 0;

  const applyChipForm = () => {
    if (!chipDraft || !chipFormValid) return;
    const next = structuredClone(chipDraft);
    const chip: MessageChip = {
      insert: chipFormInsert,
      label: chipLabel.trim(),
      labelAr: chipLabelAr.trim() || chipLabel.trim(),
    };
    if (chipEditIndex == null) next[chipScope].push(chip);
    else next[chipScope][chipEditIndex] = chip;
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
          toast({ title: t("Fields updated for the team", "تم تحديث الحقول للفريق") });
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
              ? t("Edit template", "تعديل القالب")
              : editingAutomation
                ? t("Edit automation", "تعديل الأتمتة")
                : showGallery
                  ? t("Start a new automation", "ابدأ أتمتة جديدة")
                  : t("New automation", "أتمتة جديدة")}
          </DialogTitle>
          <DialogDescription>
            {showGallery
              ? t(
                  "Start from a ready-made template, or build your own from scratch.",
                  "ابدأ من قالب جاهز، أو أنشئ أتمتتك من الصفر.",
                )
              : t(
                  "When something happens, do something automatically.",
                  "عندما يحدث شيء، نفّذ إجراءً تلقائيًا.",
                )}
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
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3 text-start transition-colors hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <span className="text-xl">{tpl.emoji}</span>
                  <span className="text-sm font-semibold text-slate-800">
                    {lang === "ar" ? tpl.nameAr : tpl.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {lang === "ar" ? tpl.descriptionAr : tpl.description}
                  </span>
                </button>
              ))}

              {savedTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="group relative flex flex-col gap-1 rounded-lg border border-slate-200 p-3 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
                >
                  <button
                    type="button"
                    onClick={() => applySaved(tpl)}
                    className="flex flex-col gap-1 text-start"
                  >
                    <span className="text-xl">{tpl.emoji || "⚙️"}</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {tpl.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {tpl.description || t("Team template", "قالب الفريق")}
                    </span>
                    {tpl.createdByName && (
                      <span className="text-[11px] text-slate-400">
                        Saved by {tpl.createdByName}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${tpl.name}`}
                    onClick={() => {
                      applySaved(tpl);
                      setEditingTemplate(tpl);
                      setStep("trigger");
                    }}
                    className="absolute end-8 top-2 rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:text-slate-700 group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Delete ${tpl.name}`}
                        disabled={deleteTemplate.isPending}
                        className="absolute end-2 top-2 rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete “{tpl.name}” for the whole team?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This template is shared: deleting it removes it for
                          everyone. Automations already created from it keep
                          working.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
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
                          className="bg-red-600 text-white hover:bg-red-700"
                        >
                          Delete template
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
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" /> {t("Start from scratch", "ابدأ من الصفر")}
            </button>
          </div>
        ) : (
          <>
            {/* Stepper */}
            <ol className="flex items-center gap-2 text-xs">
              {STEPS.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                      i <= stepIdx
                        ? "bg-teal-600 text-white"
                        : "bg-slate-100 text-slate-400",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      i === stepIdx
                        ? "font-medium text-slate-800"
                        : "text-slate-400",
                    )}
                  >
                    {t(
                      s.label,
                      { Trigger: "المشغّل", Conditions: "الشروط", Action: "الإجراء", Name: "الاسم" }[s.label] ?? s.label,
                    )}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className="mx-1 h-px w-6 bg-slate-200" />
                  )}
                </li>
              ))}
            </ol>

            <div
              className="min-h-[16rem] py-2"
              dir={lang === "ar" ? "rtl" : "ltr"}
            >
              {step === "trigger" && (
                <div className="space-y-4">
                  <Label className="text-xs text-slate-500">
                    {t("Trigger event", "حدث التشغيل")}
                  </Label>
                  <RadioGroup
                    value={event}
                    onValueChange={(v) => setEvent(v as AutomationTriggerEvent)}
                    className="mt-2 space-y-2"
                  >
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                      <RadioGroupItem value="deal_added" className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium text-slate-800">
                          {t("Deal created", "إنشاء صفقة")}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {t(
                            "Runs when a new deal is created in the app or from an inbound lead (not CSV imports).",
                            "يعمل عند إنشاء صفقة جديدة في التطبيق أو من عميل محتمل وارد (لا يشمل استيراد CSV).",
                          )}
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                      <RadioGroupItem value="deal_updated" className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-medium text-slate-800">
                          {t("Deal updated", "تحديث صفقة")}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {t(
                            "Runs when a deal changes: stage, value, owner, status, and so on. With conditions, it runs once, on the change that makes the deal match them; later edits don’t repeat it. To act when a deal is won, add a “Status is won” condition.",
                            "يعمل عند تغيير الصفقة: المرحلة أو القيمة أو المالك أو الحالة. مع الشروط يعمل مرة واحدة عند التغيير الذي يجعل الصفقة مطابقة لها، ولا تكرره التعديلات اللاحقة. للتنفيذ عند كسب صفقة أضف شرط «الحالة مكسوبة».",
                          )}
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>
              )}

              {step === "conditions" && (
                <div>
                  <Label className="text-xs text-slate-500">
                    {t("Conditions", "الشروط")}
                  </Label>
                  <p className="mb-2 text-xs text-slate-400">
                    {lang === "ar"
                      ? `يجب أن تطابق الصفقة هذه الشروط لكي تعمل الأتمتة. اتركها فارغة لتعمل مع كل صفقة ${event === "deal_added" ? "جديدة" : "محدّثة"}.`
                      : `The deal must match these for the automation to run. Leave empty to run on every ${event === "deal_added" ? "new" : "updated"} deal.`}
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
                    <Label className="text-xs text-slate-500">
                      {t("Action", "الإجراء")}
                    </Label>
                    <RadioGroup
                      value={actionType}
                      onValueChange={(v) =>
                        setActionType(v as AutomationActionType)
                      }
                      className="mt-2 grid gap-2 sm:grid-cols-2"
                    >
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                          <RadioGroupItem
                            value="create_activity"
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium text-slate-800">
                              {t("Create activity", "إنشاء نشاط")}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {t(
                                "Schedule a call, task, or meeting on the deal.",
                                "جدولة مكالمة أو مهمة أو اجتماع على الصفقة.",
                              )}
                            </span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                          <RadioGroupItem
                            value="create_deal"
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium text-slate-800">
                              {t("Create deal", "إنشاء صفقة")}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {t(
                                "Start a follow-on deal in another pipeline.",
                                "ابدأ صفقة متابعة في خط مبيعات آخر.",
                              )}
                            </span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                          <RadioGroupItem
                            value="call_webhook"
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-sm font-medium text-slate-800">
                              {t("Call webhook", "استدعاء Webhook")}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {t(
                                "Send the deal to an external URL (n8n, Zapier, your own endpoint).",
                                "أرسل الصفقة إلى رابط خارجي (n8n أو Zapier أو خادمك).",
                              )}
                            </span>
                          </span>
                        </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                        <RadioGroupItem
                          value="send_slack_message"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            {t("Send Slack message", "إرسال رسالة سلاك")}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {t(
                              "Post to a channel or DM a teammate when this fires.",
                              "انشر في قناة أو راسل زميلًا عند التشغيل.",
                            )}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                        <RadioGroupItem
                          value="post_notification"
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            {t("Post notification", "إشعار داخل التطبيق")}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {t(
                              "Notify people in-app. No opt-in needed — switching this automation on is what turns it on for the team. Each person hears only about records they own.",
                              "إشعار داخل التطبيق. لا حاجة لاشتراك — تشغيل الأتمتة هو التفعيل للفريق. ويصل كل شخص ما يخص سجلاته فقط.",
                            )}
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
                          className="text-xs text-slate-500"
                        >
                          Subject
                        </Label>
                        <Input
                          id="automation-subject"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="e.g. Intro call"
                          maxLength={200}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Type</Label>
                        <Combobox
                          items={ACTIVITY_TYPES}
                          inModal
                          value={activityType}
                          onChange={(v) => v && setActivityType(v)}
                          placeholder="Call"
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="automation-due"
                          className="text-xs text-slate-500"
                        >
                          Due in (days)
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
                        <Label className="text-xs text-slate-500">
                          Assigned to
                        </Label>
                        <Combobox
                          items={[
                            { value: DEAL_OWNER, label: "Deal owner" },
                            ...userItems,
                          ]}
                          inModal
                          value={assignee}
                          onChange={(v) => setAssignee(v || DEAL_OWNER)}
                          placeholder="Deal owner"
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                    </div>
                  )}
                  {actionType === "create_deal" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs text-slate-500">
                          Pipeline
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
                          placeholder="Select a pipeline…"
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Stage</Label>
                        <Combobox
                          items={[
                            {
                              value: FIRST_STAGE,
                              label: "First stage (default)",
                            },
                            ...pipelineStages.map((s) => ({
                              value: String(s.id),
                              label: s.name,
                            })),
                          ]}
                          inModal
                          value={stageChoice}
                          onChange={(v) => setStageChoice(v || FIRST_STAGE)}
                          placeholder="First stage (default)"
                          triggerClassName="mt-1 h-9 w-full"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="automation-title"
                          className="text-xs text-slate-500"
                        >
                          Title template
                        </Label>
                        <Input
                          id="automation-title"
                          value={titleTemplate}
                          onChange={(e) => setTitleTemplate(e.target.value)}
                          placeholder="Leave empty to copy the source deal's title"
                          maxLength={300}
                          className="mt-1"
                        />
                        <p className="mt-1 text-xs text-slate-400">
                          Use {"{title}"} to insert the source deal&apos;s
                          title, e.g. “Onboarding - {"{title}"}”.
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs text-slate-500">Owner</Label>
                        <Combobox
                          items={[
                            {
                              value: DEAL_OWNER,
                              label: "Deal owner (same as source deal)",
                            },
                            {
                              value: AUTO_ASSIGN,
                              label: "Auto-assign (assignment rules)",
                            },
                            ...userItems,
                          ]}
                          inModal
                          value={owner}
                          onChange={(v) => setOwner(v || DEAL_OWNER)}
                          placeholder="Deal owner"
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
                          className="text-xs text-slate-500"
                        >
                          Webhook URL
                        </Label>
                        <Input
                          id="webhook-url"
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          placeholder="https://example.com/hooks/deal"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Method</Label>
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
                          className="text-xs text-slate-500"
                        >
                          Include deal data
                        </Label>
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="webhook-secret-header"
                          className="text-xs text-slate-500"
                        >
                          Secret header name (optional)
                        </Label>
                        <Input
                          id="webhook-secret-header"
                          value={webhookSecretHeader}
                          onChange={(e) =>
                            setWebhookSecretHeader(e.target.value)
                          }
                          placeholder="X-Webhook-Secret"
                          className="mt-1"
                        />
                        <p className="mt-1 text-xs text-slate-400">
                          If set, the configured integration webhook secret is
                          sent under this header so your endpoint can verify the
                          call.
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
                        <Label className="text-xs text-slate-500">
                          {t("Send to", "أرسل إلى")}
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
                              {t("A Slack channel", "قناة سلاك")}
                            </SelectItem>
                            <SelectItem value="deal_owner">
                              {t("DM the deal owner", "رسالة خاصة لمالك الصفقة")}
                            </SelectItem>
                            <SelectItem value="user">
                              {t("DM a specific person", "رسالة خاصة لشخص محدد")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {actionType === "send_slack_message" &&
                        slackDestType === "channel" && (
                        <div>
                          <Label className="text-xs text-slate-500">
                            {t("Channel", "القناة")}
                          </Label>
                          {slackChannelsAvailable ? (
                            <Combobox
                              inModal
                              items={slackChannelItems}
                              value={slackChannel}
                              onChange={(v) => setSlackChannel(v || "")}
                              placeholder="Pick a channel…"
                              triggerClassName="mt-1 h-9 w-full"
                            />
                          ) : (
                            <Input
                              id="slack-channel"
                              value={slackChannel}
                              onChange={(e) => setSlackChannel(e.target.value)}
                              placeholder="#sales-wins"
                              className="mt-1"
                            />
                          )}
                          <p className="mt-1 text-xs text-slate-400">
                            {slackChannelsAvailable
                              ? t(
                                  "Pick from your workspace's channels. For private channels, add the Slack app to the channel first.",
                                  "اختر من قنوات مساحة العمل. للقنوات الخاصة أضف تطبيق سرداب إلى القناة أولًا.",
                                )
                              : t(
                                  "Type a channel like #sales-wins, or leave blank for the default announcements channel. If Slack isn't fully connected yet, messages go to the default channel.",
                                  "اكتب اسم قناة مثل ‎#sales-wins، أو اتركه فارغًا لقناة الإعلانات الافتراضية.",
                                )}
                          </p>
                        </div>
                      )}

                      {actionType === "send_slack_message" &&
                        slackDestType === "user" && (
                        <div>
                          <Label className="text-xs text-slate-500">
                            {t("Recipient", "المستلم")}
                          </Label>
                          <Combobox
                            items={userItems}
                            inModal
                            value={slackUser}
                            onChange={(v) => setSlackUser(v || "")}
                            placeholder="Pick a teammate…"
                            triggerClassName="mt-1 h-9 w-full"
                          />
                        </div>
                      )}

                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="slack-message"
                          className="text-xs text-slate-500"
                        >
                          {t("Message", "الرسالة")}
                        </Label>

                        {/* Field chips — click to insert, no typing braces */}
                        {!manageChips ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {activeChips.map((c) => (
                              <button
                                key={c.insert + c.label}
                                type="button"
                                onClick={() => insertToken(c.insert)}
                                className="rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
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
                              className="ms-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            >
                              ⚙ {t("Customize fields", "تخصيص الحقول")}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {t(
                                "Customize fields for the whole team",
                                "تخصيص الحقول للفريق كامل",
                              )}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {t(
                                "Click a field to edit it, or × to remove it. New fields can insert data or your own text.",
                                "اضغط على حقل لتعديله أو × لحذفه. الحقول الجديدة تُدرج بيانات أو نصًا خاصًا بك.",
                              )}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {activeChips.map((c, i) => (
                                <span
                                  key={c.insert + c.label + i}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                                    chipEditIndex === i
                                      ? "border-teal-500 bg-teal-100 text-teal-800"
                                      : "border-teal-200 bg-teal-50 text-teal-700",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setChipEditIndex(i);
                                      setChipLabel(c.label);
                                      setChipLabelAr(c.labelAr ?? "");
                                      setChipInsertText(c.insert);
                                    }}
                                  >
                                    {lang === "ar" ? c.labelAr || c.label : c.label}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={t("Remove field", "حذف الحقل")}
                                    onClick={() => {
                                      if (!chipDraft) return;
                                      const next = structuredClone(chipDraft);
                                      next[chipScope].splice(i, 1);
                                      setChipDraft(next);
                                      if (chipEditIndex === i) resetChipForm();
                                    }}
                                    className="text-teal-400 hover:text-red-600"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <div>
                                <Label className="text-[11px] text-slate-500">
                                  {t("Name", "الاسم")}
                                </Label>
                                <Input
                                  value={chipLabel}
                                  onChange={(e) => setChipLabel(e.target.value)}
                                  placeholder={t("e.g. Deal name", "مثال: اسم الصفقة")}
                                  maxLength={40}
                                  className="mt-1 h-8 text-xs"
                                />
                              </div>
                              <div>
                                <Label className="text-[11px] text-slate-500">
                                  {t("What it inserts", "ماذا يُدرج")}
                                </Label>
                                <Input
                                  value={chipInsertText}
                                  onChange={(e) => setChipInsertText(e.target.value)}
                                  placeholder={t(
                                    "{{deal.title}} or any text",
                                    "{{deal.title}} أو أي نص",
                                  )}
                                  maxLength={120}
                                  dir="auto"
                                  className="mt-1 h-8 font-mono text-xs"
                                />
                              </div>
                            </div>
                            <p className="mt-1.5 text-[10.5px] text-slate-400">
                              {t("Fields you can use:", "الحقول المتاحة:")}{" "}
                              {DEFAULT_DEAL_CHIPS
                                .map((f) => f.insert)
                                .join("  ")}
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
                                  ? t("Add field", "إضافة حقل")
                                  : t("Update field", "تحديث الحقل")}
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
                                  {t("Cancel", "إلغاء")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={updateChips.isPending}
                                  onClick={saveChipConfig}
                                  className="bg-teal-600 text-white hover:bg-teal-700"
                                >
                                  {updateChips.isPending && (
                                    <Loader2 className="me-1.5 h-3 w-3 animate-spin" />
                                  )}
                                  {t("Save fields", "حفظ الحقول")}
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
                                    ? t(
                                        "Write your message, then tap a field above to drop it in.",
                                        "اكتب رسالتك ثم اضغط على أي حقل بالأعلى لإدراجه.",
                                      )
                                    : t("Another line…", "سطر إضافي…")
                                }
                                className={cn(
                                  "flex-1",
                                  msgFocus === i && "border-teal-400",
                                )}
                              />
                              <button
                                type="button"
                                aria-label={t("Delete this line", "حذف هذا السطر")}
                                disabled={msgRows.length === 1 && !row}
                                onClick={() => deleteMsgRow(i)}
                                className="rounded-md p-1.5 text-slate-300 transition-colors hover:text-red-600 disabled:opacity-30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addMsgRow}
                            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t("Add another line", "أضف سطرًا آخر")}
                          </button>
                        </div>

                        {/* Live preview against sample data */}
                        <div className="mt-2 rounded-md border-s-2 border-teal-500 bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                            {t("Preview (sample data)", "معاينة (بيانات تجريبية)")}
                          </p>
                          <p
                            dir="auto"
                            className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700"
                          >
                            {messagePreview.trim() ||
                              t(
                                "Your message preview will appear here.",
                                "ستظهر معاينة رسالتك هنا.",
                              )}
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
                            {t("Send test message", "إرسال رسالة تجريبية")}
                          </Button>
                          <span className="ms-2 text-xs text-slate-400">
                            {t(
                              "Sent privately to you in Slack, never to the channel.",
                              "تصلك وحدك في سلاك، لا تُرسل إلى القناة أبدًا.",
                            )}
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
                      className="text-xs text-slate-500"
                    >
                      {t("Automation name", "اسم الأتمتة")}
                    </Label>
                    <Input
                      id="automation-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && name.trim() && !busy && save()
                      }
                      placeholder="e.g. “Schedule intro call for new deals”"
                      maxLength={200}
                      autoFocus
                    />
                  </div>

                  {/* Plain-words confirmation */}
                  <div className="rounded-lg bg-amber-50 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {t("In plain words", "بكلمات بسيطة")}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {plainSentence}
                    </p>
                  </div>

                  {!editingTemplate && !editingAutomation && (
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <Switch
                        checked={saveAsTemplate}
                        onCheckedChange={setSaveAsTemplate}
                      />
                      <span className="text-sm text-slate-600">
                        {t(
                          "Also save this as a reusable template for the team",
                          "احفظها أيضًا كقالب قابل لإعادة الاستخدام للفريق",
                        )}
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
              {t("Back", "رجوع")}
            </Button>
            {step === "name" ? (
              <div className="flex items-center gap-2">
                {!editingTemplate && !editingAutomation && (
                  <Button
                    variant="outline"
                    onClick={saveTemplateOnly}
                    disabled={!name.trim() || busy}
                  >
                    {t("Save as template only", "حفظ كقالب فقط")}
                  </Button>
                )}
                <Button
                  onClick={editingTemplate ? saveTemplateEdit : save}
                  disabled={!name.trim() || busy}
                  className="bg-teal-600 text-white hover:bg-teal-700"
                >
                  {busy && (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {editingTemplate
                    ? t("Save template", "حفظ القالب")
                    : editingAutomation
                      ? t("Save changes", "حفظ التعديلات")
                      : t("Create automation", "إنشاء الأتمتة")}
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => canAdvance && setStep(STEPS[stepIdx + 1].id)}
                disabled={!canAdvance || busy}
                className="bg-teal-600 text-white hover:bg-teal-700"
              >
                {t("Next", "التالي")}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
