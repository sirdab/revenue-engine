import { Router, type IRouter, type Response } from "express";
import {
  AdminListAutomationsResponse,
  CreateAutomationBody,
  CreateAutomationResponse,
  UpdateAutomationParams,
  UpdateAutomationBody,
  UpdateAutomationResponse,
  DeleteAutomationParams,
  ReorderAutomationsBody,
  ListAutomationTemplatesResponse,
  CreateAutomationTemplateBody,
  CreateAutomationTemplateResponse,
  UpdateAutomationTemplateBody,
  UpdateAutomationTemplateResponse,
  ListSlackChannelsResponse,
  TestAutomationMessageBody,
  TestAutomationMessageResponse,
  GetAutomationChipsResponse,
  UpdateAutomationChipsBody,
  UpdateAutomationChipsResponse,
} from "@workspace/api-zod";
import { requireAdmin, currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  adminListAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  reorderAutomations,
  AutomationError,
} from "../lib/automation-admin";
import {
  listAutomationTemplates,
  createAutomationTemplate,
  updateAutomationTemplate,
  deleteAutomationTemplate,
} from "../lib/automation-templates";
import {
  listWorkspaceChannels,
  sendTestMessageToUser,
  announceAutomationCreated,
  renderAutomationTemplate,
  buildDealCardBlocks,
  isAllowedTemplateToken,
} from "../lib/slack";
import { DEFAULT_MESSAGE_CHIPS } from "@workspace/automation-placeholders";
import { getSetting, setSetting } from "../lib/app-settings";

// Human phrase for the "someone created an automation" announcement.
const TRIGGER_PHRASE: Record<string, string> = {
  deal_added: "a new deal is created",
  deal_updated: "a deal is updated",
};

// Sample data the "send test" endpoint renders the message against.
const SAMPLE_SCOPES: Record<string, Record<string, unknown>> = {
  deal: {
    id: 42,
    title: "Acme Corp - Annual Plan",
    value: "90,000",
    currency: "USD",
    status: "open",
    stageId: 3,
    pipelineId: 1,
    owner: "Jordan Lee",
    stage: "Negotiation",
    pipeline: "Sales",
    organization: "Acme Corp",
  },
};

// Admin management for deal automations. Every handler is admin-gated; the
// service owns validation (conditions vocabulary/limits, per-actionType config,
// live pipeline/stage/user checks) and raises AutomationError with an HTTP
// status.

const router: IRouter = Router();

function mapError(err: unknown, res: Response, log: string): void {
  if (err instanceof AutomationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

router.get(
  "/admin/automations",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const automations = await adminListAutomations();
    res.json(AdminListAutomationsResponse.parse({ automations }));
  },
);

router.post(
  "/admin/automations",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAutomationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const automation = await createAutomation(parsed.data);
      // Announce (once) in the target channel that this automation now exists.
      const cfg = automation.actionConfig as {
        destination?: { kind?: string; channel?: string };
      };
      if (
        automation.actionType === "send_slack_message" &&
        cfg.destination?.kind === "channel" &&
        cfg.destination.channel
      ) {
        const creator = currentUser(res);
        void announceAutomationCreated(
          cfg.destination.channel,
          creator.name,
          automation.name,
          TRIGGER_PHRASE[automation.triggerEvent] ?? "this happens",
        );
      }
      res.json(CreateAutomationResponse.parse(automation));
    } catch (err) {
      mapError(err, res, "Failed to create automation");
    }
  },
);

// Templates, channel picker, and private test — registered before the ":id"
// routes so "templates"/"slack-channels"/"test" are never captured as an id.
router.get(
  "/admin/automations/templates",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const templates = await listAutomationTemplates();
    res.json(ListAutomationTemplatesResponse.parse({ templates }));
  },
);

router.post(
  "/admin/automations/templates",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAutomationTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await createAutomationTemplate(
        parsed.data,
        currentUser(res).id,
      );
      res.json(CreateAutomationTemplateResponse.parse(created));
    } catch (err) {
      mapError(err, res, "Failed to create automation template");
    }
  },
);

router.patch(
  "/admin/automations/templates/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid template id." });
      return;
    }
    const parsed = UpdateAutomationTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await updateAutomationTemplate(id, parsed.data);
      res.json(UpdateAutomationTemplateResponse.parse(updated));
    } catch (err) {
      mapError(err, res, "Failed to update automation template");
    }
  },
);

router.delete(
  "/admin/automations/templates/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid template id." });
      return;
    }
    try {
      await deleteAutomationTemplate(id);
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to delete automation template");
    }
  },
);

// Field-chip config for the wizard's message editor — org-wide, stored as a
// JSON app-setting. GET returns the defaults until someone customizes.
const CHIPS_SETTING_KEY = "automation_message_chips";
const DEFAULT_CHIPS = DEFAULT_MESSAGE_CHIPS;

router.get(
  "/admin/automations/chips",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const raw = await getSetting(CHIPS_SETTING_KEY);
    let config = DEFAULT_CHIPS;
    if (raw) {
      try {
        const parsed = UpdateAutomationChipsBody.safeParse(JSON.parse(raw));
        if (parsed.success) config = parsed.data as typeof DEFAULT_CHIPS;
      } catch {
        /* corrupt setting → defaults */
      }
    }
    res.json(GetAutomationChipsResponse.parse(config));
  },
);

router.put(
  "/admin/automations/chips",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateAutomationChipsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    for (const scope of ["deal"] as const) {
      for (const chip of parsed.data[scope]) {
        if (!isAllowedTemplateToken(chip.insert)) {
          res.status(400).json({
            error: `"${chip.label}" points at a field that doesn't exist (${chip.insert}).`,
          });
          return;
        }
      }
    }
    await setSetting(CHIPS_SETTING_KEY, JSON.stringify(parsed.data));
    res.json(UpdateAutomationChipsResponse.parse(parsed.data));
  },
);

router.get(
  "/admin/automations/slack-channels",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const result = await listWorkspaceChannels();
    res.json(ListSlackChannelsResponse.parse(result));
  },
);

router.post(
  "/admin/automations/test",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = TestAutomationMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.actionType !== "send_slack_message") {
      res.json(
        TestAutomationMessageResponse.parse({
          delivered: false,
          detail: "Testing is only available for the Send Slack message action.",
        }),
      );
      return;
    }
    const cfg = parsed.data.actionConfig as {
      message?: string;
      destination?: { kind?: string; channel?: string };
    };
    const rendered = renderAutomationTemplate(cfg.message ?? "", SAMPLE_SCOPES);
    const preface =
      cfg.destination?.kind === "channel"
        ? `🧪 Test: this is what would post to #${(cfg.destination.channel || "your channel").replace(/^#/, "")}:`
        : "🧪 Test preview: this is the message this automation would send:";
    // Same rich card the real send produces, rendered against sample data.
    const card = buildDealCardBlocks(rendered, {
      valueText: "90,000 USD",
      ownerName: "Jordan Lee",
      pipelineName: "Sales",
      organizationName: "Acme Corp",
      dealId: 42,
    });
    const blocks = [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: preface }],
      },
      ...card,
    ];
    const out = await sendTestMessageToUser(
      currentUser(res).email ?? "",
      `${preface}\n\n${rendered}`,
      blocks,
    );
    res.json(TestAutomationMessageResponse.parse(out));
  },
);

// The reorder route is registered before the ":id" routes so "reorder" is never
// captured as an id.
router.post(
  "/admin/automations/reorder",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = ReorderAutomationsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await reorderAutomations(
        parsed.data.triggerEvent,
        parsed.data.orderedIds,
      );
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to reorder automations");
    }
  },
);

router.patch(
  "/admin/automations/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateAutomationParams.safeParse(req.params);
    const body = UpdateAutomationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: (params.success ? body : params).error?.message,
      });
      return;
    }
    try {
      const automation = await updateAutomation(params.data.id, body.data);
      res.json(UpdateAutomationResponse.parse(automation));
    } catch (err) {
      mapError(err, res, "Failed to update automation");
    }
  },
);

router.delete(
  "/admin/automations/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteAutomationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await deleteAutomation(params.data.id);
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to delete automation");
    }
  },
);

export default router;
