import { Router, type IRouter, type Response } from "express";
import {
  AdminListAssignmentRulesResponse,
  CreateAssignmentRuleBody,
  CreateAssignmentRuleResponse,
  UpdateAssignmentRuleParams,
  UpdateAssignmentRuleBody,
  UpdateAssignmentRuleResponse,
  DeleteAssignmentRuleParams,
  ReorderAssignmentRulesBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  adminListAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  deleteAssignmentRule,
  reorderAssignmentRules,
  AssignmentRuleError,
} from "../lib/assignment-rules";

// Admin management for auto-assignment rules. Every handler is admin-gated; the
// service owns validation (conditions vocabulary/limits, team/assignee
// membership) and raises AssignmentRuleError with an HTTP status.

const router: IRouter = Router();

function mapError(err: unknown, res: Response, log: string): void {
  if (err instanceof AssignmentRuleError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

router.get(
  "/admin/assignment-rules",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const rules = await adminListAssignmentRules();
    res.json(AdminListAssignmentRulesResponse.parse({ rules }));
  },
);

router.post(
  "/admin/assignment-rules",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAssignmentRuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const rule = await createAssignmentRule(parsed.data);
      res.json(CreateAssignmentRuleResponse.parse(rule));
    } catch (err) {
      mapError(err, res, "Failed to create assignment rule");
    }
  },
);

// The reorder route is registered before the ":id" routes so "reorder" is never
// captured as an id.
router.post(
  "/admin/assignment-rules/reorder",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = ReorderAssignmentRulesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await reorderAssignmentRules(
        parsed.data.triggerEvent,
        parsed.data.orderedIds,
      );
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to reorder assignment rules");
    }
  },
);

router.patch(
  "/admin/assignment-rules/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateAssignmentRuleParams.safeParse(req.params);
    const body = UpdateAssignmentRuleBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: (params.success ? body : params).error?.message,
      });
      return;
    }
    try {
      const rule = await updateAssignmentRule(params.data.id, body.data);
      res.json(UpdateAssignmentRuleResponse.parse(rule));
    } catch (err) {
      mapError(err, res, "Failed to update assignment rule");
    }
  },
);

router.delete(
  "/admin/assignment-rules/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteAssignmentRuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await deleteAssignmentRule(params.data.id);
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to delete assignment rule");
    }
  },
);

export default router;
