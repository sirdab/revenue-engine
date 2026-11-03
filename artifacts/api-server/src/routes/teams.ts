import { Router, type IRouter } from "express";
import { ListTeamsResponse } from "@workspace/api-zod";
import { listActiveTeams } from "../lib/teams";

// Read-only teams endpoint for pickers and future assignment rules (any
// authenticated user). Admin management lives in routes/admin-teams.ts.

const router: IRouter = Router();

router.get("/teams", async (_req, res): Promise<void> => {
  const teams = await listActiveTeams();
  res.json(ListTeamsResponse.parse(teams));
});

export default router;
