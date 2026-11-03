import { Router, type IRouter, type Response } from "express";
import {
  AdminListLabelsQueryParams,
  AdminListLabelsResponse,
  CreateLabelBody,
  CreateLabelResponse,
  UpdateLabelParams,
  UpdateLabelBody,
  UpdateLabelResponse,
  DeleteLabelParams,
  DeleteLabelResponse,
  AdminListLostReasonsResponse,
  CreateLostReasonBody,
  CreateLostReasonResponse,
  UpdateLostReasonParams,
  UpdateLostReasonBody,
  UpdateLostReasonResponse,
  DeleteLostReasonParams,
} from "@workspace/api-zod";
import { requireAdmin, currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  adminListLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  LabelError,
} from "../lib/labels";
import {
  adminListLostReasons,
  createLostReason,
  updateLostReason,
  deleteLostReason,
} from "../lib/lost-reasons";

// Admin management for the label registry and the managed lost-reason list.
// Mutations that touch names rewrite the denormalized values on records inside
// the same transaction (see lib/labels.ts / lib/lost-reasons.ts).

const router: IRouter = Router();

function mapError(err: unknown, res: Response, log: string): void {
  if (err instanceof LabelError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

router.get("/admin/labels", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdminListLabelsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = await adminListLabels(parsed.data.entity);
  res.json(AdminListLabelsResponse.parse(data));
});

router.post("/admin/labels", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const label = await createLabel(
      parsed.data.entity,
      parsed.data.name,
      parsed.data.color,
    );
    res.json(CreateLabelResponse.parse(label));
  } catch (err) {
    mapError(err, res, "Failed to create label");
  }
});

router.patch(
  "/admin/labels/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateLabelParams.safeParse(req.params);
    const body = UpdateLabelBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: (params.success ? body : params).error?.message,
      });
      return;
    }
    try {
      const user = currentUser(res);
      const label = await updateLabel(params.data.id, body.data, {
        changedBy: user.id,
        source: "ui",
      });
      res.json(UpdateLabelResponse.parse(label));
    } catch (err) {
      mapError(err, res, "Failed to update label");
    }
  },
);

router.delete(
  "/admin/labels/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteLabelParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      const user = currentUser(res);
      const result = await deleteLabel(params.data.id, {
        changedBy: user.id,
        source: "ui",
      });
      res.json(DeleteLabelResponse.parse(result));
    } catch (err) {
      mapError(err, res, "Failed to delete label");
    }
  },
);

// ---------------------------------------------------------------------------
// Lost reasons
// ---------------------------------------------------------------------------

router.get(
  "/admin/lost-reasons",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const data = await adminListLostReasons();
    res.json(AdminListLostReasonsResponse.parse(data));
  },
);

router.post(
  "/admin/lost-reasons",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateLostReasonBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const reason = await createLostReason(parsed.data.name);
      res.json(CreateLostReasonResponse.parse(reason));
    } catch (err) {
      mapError(err, res, "Failed to create lost reason");
    }
  },
);

router.patch(
  "/admin/lost-reasons/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateLostReasonParams.safeParse(req.params);
    const body = UpdateLostReasonBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: (params.success ? body : params).error?.message,
      });
      return;
    }
    try {
      const reason = await updateLostReason(params.data.id, body.data);
      res.json(UpdateLostReasonResponse.parse(reason));
    } catch (err) {
      mapError(err, res, "Failed to update lost reason");
    }
  },
);

router.delete(
  "/admin/lost-reasons/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteLostReasonParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await deleteLostReason(params.data.id);
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to delete lost reason");
    }
  },
);

export default router;
