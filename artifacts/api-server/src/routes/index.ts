import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import pipelinesRouter from "./pipelines";
import stagesRouter from "./stages";
import adminPipelinesRouter from "./admin-pipelines";
import dealsRouter from "./deals";
import dealFieldsRouter from "./deal-fields";
import dealViewsRouter from "./deal-views";
import userPreferencesRouter from "./user-preferences";
import personsRouter from "./persons";
import organizationsRouter from "./organizations";
import activitiesRouter from "./activities";
import notesRouter from "./notes";
import notificationsRouter from "./notifications";
import notificationRulesRouter from "./notification-rules";
import changesRouter from "./changes";
import usersRouter from "./users";
import searchRouter from "./search";
import labelsRouter from "./labels";
import adminLabelsRouter from "./admin-labels";
import teamsRouter from "./teams";
import adminTeamsRouter from "./admin-teams";
import adminAssignmentRulesRouter from "./admin-assignment-rules";
import adminAutomationsRouter from "./admin-automations";
import importRouter from "./import";
import webhooksRouter from "./webhooks";
import settingsRouter from "./settings";
import filesRouter from "./files";
import insightsRouter from "./insights";
import assistantRouter from "./assistant";
import workspaceRouter from "./workspace";
import { requireAuth } from "../lib/auth";
import { dbClientErrorHandler } from "../lib/pg-errors";

const router: IRouter = Router();

// Public routes
router.use(healthRouter);
router.use(authRouter);
// Inbound automation webhooks authenticate with their own shared secret, so
// they must stay OUTSIDE the session-cookie auth below.
router.use(webhooksRouter);

// Everything below requires an authenticated session
router.use(requireAuth);

router.use(workspaceRouter);
router.use(pipelinesRouter);
router.use(stagesRouter);
router.use(adminPipelinesRouter);
router.use(dealsRouter);
router.use(dealFieldsRouter);
router.use(dealViewsRouter);
router.use(userPreferencesRouter);
router.use(personsRouter);
router.use(organizationsRouter);
router.use(activitiesRouter);
router.use(notesRouter);
router.use(notificationsRouter);
router.use(notificationRulesRouter);
router.use(changesRouter);
router.use(usersRouter);
router.use(searchRouter);
router.use(labelsRouter);
router.use(adminLabelsRouter);
router.use(teamsRouter);
router.use(adminTeamsRouter);
router.use(adminAssignmentRulesRouter);
router.use(adminAutomationsRouter);
router.use(importRouter);
router.use(settingsRouter);
router.use(filesRouter);
router.use(insightsRouter);
router.use(assistantRouter);

// Bad input the database caught (an id that points at nothing, 2026-02-30, a
// number too large for its column) is a 4xx, not a 500 — see lib/pg-errors.ts.
// Anything else falls through to the app-level 500 handler.
router.use(dbClientErrorHandler);

export default router;
