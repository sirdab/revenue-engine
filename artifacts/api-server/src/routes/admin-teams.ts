import { Router, type IRouter, type Response } from "express";
import {
  AdminListTeamsResponse,
  CreateTeamBody,
  CreateTeamResponse,
  UpdateTeamParams,
  UpdateTeamBody,
  UpdateTeamResponse,
  DeleteTeamParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  adminListTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  TeamError,
} from "../lib/teams";

// Admin management for teams. Every handler is admin-gated. Membership is
// assigned through the users route (PATCH /users/:id with { teamId }), not here.

const router: IRouter = Router();

function mapError(err: unknown, res: Response, log: string): void {
  if (err instanceof TeamError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, log);
  res.status(500).json({ error: "Something went wrong." });
}

router.get("/admin/teams", requireAdmin, async (_req, res): Promise<void> => {
  const teams = await adminListTeams();
  res.json(AdminListTeamsResponse.parse({ teams }));
});

router.post("/admin/teams", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const team = await createTeam(parsed.data.name);
    res.json(CreateTeamResponse.parse(team));
  } catch (err) {
    mapError(err, res, "Failed to create team");
  }
});

router.patch(
  "/admin/teams/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateTeamParams.safeParse(req.params);
    const body = UpdateTeamBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: (params.success ? body : params).error?.message,
      });
      return;
    }
    try {
      const team = await updateTeam(params.data.id, body.data);
      res.json(UpdateTeamResponse.parse(team));
    } catch (err) {
      mapError(err, res, "Failed to update team");
    }
  },
);

router.delete(
  "/admin/teams/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteTeamParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      await deleteTeam(params.data.id);
      res.status(204).end();
    } catch (err) {
      mapError(err, res, "Failed to delete team");
    }
  },
);

export default router;
