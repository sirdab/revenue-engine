import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  insightsDashboardsTable,
  insightsWidgetsTable,
  usersTable,
  type InsightsDashboard,
  type InsightsWidget,
} from "@workspace/db";
import {
  ListInsightsWidgetsQueryParams,
  CreateInsightsDashboardBody,
  UpdateInsightsDashboardParams,
  UpdateInsightsDashboardBody,
  DeleteInsightsDashboardParams,
  DuplicateInsightsDashboardParams,
  DuplicateInsightsDashboardBody,
  CreateInsightsWidgetBody,
  UpdateInsightsWidgetParams,
  UpdateInsightsWidgetBody,
  DeleteInsightsWidgetParams,
  DuplicateInsightsWidgetParams,
  DuplicateInsightsWidgetBody,
  RunInsightsQueryBody,
  RunInsightsQueryBatchBody,
  ListInsightsFieldsQueryParams,
} from "@workspace/api-zod";
import { migrateSpec, widgetVizSchema, type WidgetSpec } from "@workspace/insights-spec";
import { currentUser } from "../lib/auth";
import { listInsightsFields } from "../lib/insights/fields";
import { InsightsQueryError, type GlobalFilters } from "../lib/insights/compile-deals";
import { AnalyticsBusyError } from "../lib/insights/analytics-db";
import { runInsightsSpec } from "../lib/insights/run-query";
import {
  packLayout,
  STARTER_DASHBOARD_NAME,
  STARTER_WIDGETS,
} from "../lib/insights/starter";
import { logger } from "../lib/logger";
import { insightsQueryRateLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

// Visibility model (ADR-E1): the app has no row-level scoping, so query
// results match list views for every authenticated user. Dashboards/widgets
// themselves are per-user documents: owners mutate, shared users read.

/** The dashboard is shared and lists this user (view-only access). */
function dashboardSharedWith(userId: number) {
  return and(
    eq(insightsDashboardsTable.isShared, true),
    sql`${insightsDashboardsTable.sharedUserIds} @> ${JSON.stringify([userId])}::jsonb`,
  );
}

function dashboardVisibleTo(userId: number) {
  return or(
    eq(insightsDashboardsTable.ownerId, userId),
    dashboardSharedWith(userId),
  );
}

/** Mutations require ownership, not just visibility. */
function ownedDashboard(id: number, userId: number) {
  return and(
    eq(insightsDashboardsTable.id, id),
    eq(insightsDashboardsTable.ownerId, userId),
  );
}

function ownedWidget(id: number, userId: number) {
  return and(
    eq(insightsWidgetsTable.id, id),
    eq(insightsWidgetsTable.ownerId, userId),
  );
}

function widgetsFor(dashboardId: number): Promise<InsightsWidget[]> {
  return db
    .select()
    .from(insightsWidgetsTable)
    .where(eq(insightsWidgetsTable.dashboardId, dashboardId))
    .orderBy(asc(insightsWidgetsTable.id));
}

function serializeDashboard(
  dashboard: InsightsDashboard,
  widgets: InsightsWidget[],
) {
  return { ...dashboard, widgets };
}

router.get("/insights/dashboards", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  const dashboards = await db
    .select()
    .from(insightsDashboardsTable)
    .where(dashboardVisibleTo(user.id))
    .orderBy(asc(insightsDashboardsTable.section), asc(insightsDashboardsTable.name));
  const ids = dashboards.map((d) => d.id);
  const widgets =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(insightsWidgetsTable)
          .where(inArray(insightsWidgetsTable.dashboardId, ids))
          .orderBy(asc(insightsWidgetsTable.id));
  const byDashboard = new Map<number, InsightsWidget[]>();
  for (const w of widgets) {
    if (w.dashboardId == null) continue;
    const list = byDashboard.get(w.dashboardId) ?? [];
    list.push(w);
    byDashboard.set(w.dashboardId, list);
  }
  res.json(
    dashboards.map((d) => serializeDashboard(d, byDashboard.get(d.id) ?? [])),
  );
});

router.post("/insights/dashboards", async (req, res): Promise<void> => {
  const parsed = CreateInsightsDashboardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const [created] = await db
    .insert(insightsDashboardsTable)
    .values({
      name: parsed.data.name,
      section: parsed.data.section ?? null,
      ownerId: user.id,
      globalFilters: parsed.data.globalFilters ?? null,
      layout: parsed.data.layout ?? [],
    })
    .returning();
  res.status(201).json(serializeDashboard(created, []));
});

/** Millisecond-precision equality for the optimistic-concurrency check:
 *  `defaultNow()` rows carry microseconds that a JSON round-trip (Date →
 *  toISOString) cannot represent, so raw equality would false-conflict. */
function updatedAtMatches(expected: Date): ReturnType<typeof sql> {
  return sql`date_trunc('milliseconds', ${insightsDashboardsTable.updatedAt}) = ${expected.toISOString()}::timestamptz`;
}

/** Every id must be a real user — sharing must not accumulate dangling ids. */
async function allUsersExist(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  return rows.length === ids.length;
}

router.patch("/insights/dashboards/:id", async (req, res): Promise<void> => {
  const params = UpdateInsightsDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInsightsDashboardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const owned = ownedDashboard(params.data.id, user.id);

  const updates: Partial<typeof insightsDashboardsTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.name !== undefined) updates.name = d.name;
  if (d.section !== undefined) updates.section = d.section;
  if (d.globalFilters !== undefined) updates.globalFilters = d.globalFilters;
  if (d.layout !== undefined) updates.layout = d.layout;
  if (d.isShared !== undefined) updates.isShared = d.isShared;
  if (d.sharedUserIds !== undefined) {
    const ids = [...new Set(d.sharedUserIds)];
    if (!(await allUsersExist(ids))) {
      res.status(400).json({ error: "sharedUserIds contains unknown users" });
      return;
    }
    updates.sharedUserIds = ids;
  }

  const serialize = async (dashboard: InsightsDashboard) =>
    serializeDashboard(dashboard, await widgetsFor(dashboard.id));

  // A body with nothing to change is a no-op, not a 500: `set({})` throws.
  if (Object.keys(updates).length === 0) {
    const [current] = await db
      .select()
      .from(insightsDashboardsTable)
      .where(owned);
    if (!current) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    res.json(await serialize(current));
    return;
  }

  // Optimistic concurrency (opt-in): a stale client — a second tab, another
  // device — must not silently clobber a newer layout with last-write-wins.
  const expected = d.expectedUpdatedAt;
  const where =
    expected !== undefined
      ? and(owned, updatedAtMatches(new Date(expected)))
      : owned;

  const [updated] = await db
    .update(insightsDashboardsTable)
    .set(updates)
    .where(where)
    .returning();
  if (!updated) {
    if (expected !== undefined) {
      const [exists] = await db
        .select({ id: insightsDashboardsTable.id })
        .from(insightsDashboardsTable)
        .where(owned);
      if (exists) {
        res.status(409).json({
          error: "Dashboard was changed elsewhere: reload and retry",
        });
        return;
      }
    }
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }
  res.json(await serialize(updated));
});

router.delete("/insights/dashboards/:id", async (req, res): Promise<void> => {
  const params = DeleteInsightsDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const [deleted] = await db
    .delete(insightsDashboardsTable)
    .where(ownedDashboard(params.data.id, user.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }
  res.sendStatus(204);
});

router.post(
  "/insights/dashboards/:id/duplicate",
  async (req, res): Promise<void> => {
    const params = DuplicateInsightsDashboardParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = DuplicateInsightsDashboardBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const user = currentUser(res);
    const [source] = await db
      .select()
      .from(insightsDashboardsTable)
      .where(
        and(
          eq(insightsDashboardsTable.id, params.data.id),
          dashboardVisibleTo(user.id),
        ),
      );
    if (!source) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    const sourceWidgets = await widgetsFor(source.id);

    // Dashboard, widgets (one batched insert), and the re-keyed layout are
    // written in a single transaction so a failure never leaves a partial
    // copy behind. RETURNING preserves VALUES order, so ids map by index.
    const { finalCopy, copiedWidgets } = await db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(insightsDashboardsTable)
        .values({
          name: body.data.name ?? `${source.name} (copy)`,
          section: source.section,
          ownerId: user.id,
          globalFilters: source.globalFilters,
          layout: [],
          isDefault: false,
          defaultKey: null,
        })
        .returning();

      let copiedWidgets: InsightsWidget[] = [];
      const idMap = new Map<number, number>();
      if (sourceWidgets.length > 0) {
        copiedWidgets = await tx
          .insert(insightsWidgetsTable)
          .values(
            sourceWidgets.map((w) => ({
              dashboardId: copy.id,
              ownerId: user.id,
              name: w.name,
              spec: w.spec,
              viz: w.viz,
            })),
          )
          .returning();
        sourceWidgets.forEach((w, i) => idMap.set(w.id, copiedWidgets[i].id));
      }
      const sourceLayout = Array.isArray(source.layout)
        ? (source.layout as { i: string; [k: string]: unknown }[])
        : [];
      const layout = sourceLayout
        .filter((item) => idMap.has(Number(item.i)))
        .map((item) => ({ ...item, i: String(idMap.get(Number(item.i))) }));
      const [finalCopy] = await tx
        .update(insightsDashboardsTable)
        .set({ layout })
        .where(eq(insightsDashboardsTable.id, copy.id))
        .returning();
      return { finalCopy, copiedWidgets };
    });
    res.status(201).json(serializeDashboard(finalCopy, copiedWidgets));
  },
);

// One transaction: dashboard + widgets + packed layout land together, or not
// at all — the previous client-side seeding (14 sequential requests) could
// strand a half-built board on any mid-loop failure.
router.post("/insights/dashboards/starter", async (_req, res): Promise<void> => {
  const user = currentUser(res);
  const created = await db.transaction(async (tx) => {
    const [dash] = await tx
      .insert(insightsDashboardsTable)
      .values({ name: STARTER_DASHBOARD_NAME, ownerId: user.id, layout: [] })
      .returning();
    const widgets = await tx
      .insert(insightsWidgetsTable)
      .values(
        STARTER_WIDGETS.map((sw) => ({
          dashboardId: dash.id,
          ownerId: user.id,
          name: sw.name,
          // Static definitions still pass the same gate as user input, so a
          // drifted starter spec fails loudly at seed time, not render time.
          spec: migrateSpec(sw.spec),
          viz: widgetVizSchema.parse(sw.viz),
        })),
      )
      .returning();
    const layout = packLayout(
      // RETURNING preserves VALUES order, so sizes map by index.
      widgets.map((w, i) => ({
        i: String(w.id),
        w: STARTER_WIDGETS[i].w,
        h: STARTER_WIDGETS[i].h,
      })),
    );
    const [final] = await tx
      .update(insightsDashboardsTable)
      .set({ layout })
      .where(eq(insightsDashboardsTable.id, dash.id))
      .returning();
    return serializeDashboard(final, widgets);
  });
  res.status(201).json(created);
});

// ---- Widgets ---------------------------------------------------------------

function parseWidgetPayload(body: {
  spec?: unknown;
  viz?: unknown;
}): { spec?: unknown; viz?: unknown; error?: string } {
  try {
    const spec = body.spec === undefined ? undefined : migrateSpec(body.spec);
    const viz = body.viz === undefined ? undefined : widgetVizSchema.parse(body.viz);
    return { spec, viz };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid widget payload" };
  }
}

async function assertDashboardOwned(
  dashboardId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: insightsDashboardsTable.id })
    .from(insightsDashboardsTable)
    .where(ownedDashboard(dashboardId, userId));
  return !!row;
}

router.get("/insights/widgets", async (req, res): Promise<void> => {
  const parsed = ListInsightsWidgetsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const where = parsed.data.library
    ? and(
        eq(insightsWidgetsTable.ownerId, user.id),
        sql`${insightsWidgetsTable.dashboardId} is null`,
      )
    : eq(insightsWidgetsTable.ownerId, user.id);
  const widgets = await db
    .select()
    .from(insightsWidgetsTable)
    .where(where)
    .orderBy(asc(insightsWidgetsTable.name));
  res.json(widgets);
});

router.post("/insights/widgets", async (req, res): Promise<void> => {
  const parsed = CreateInsightsWidgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const payload = parseWidgetPayload(parsed.data);
  if (payload.error || !payload.spec || !payload.viz) {
    res.status(400).json({ error: payload.error ?? "spec and viz are required" });
    return;
  }
  const user = currentUser(res);
  const dashboardId = parsed.data.dashboardId ?? null;
  if (dashboardId != null && !(await assertDashboardOwned(dashboardId, user.id))) {
    res.status(404).json({ error: "Dashboard not found" });
    return;
  }
  const [created] = await db
    .insert(insightsWidgetsTable)
    .values({
      dashboardId,
      ownerId: user.id,
      name: parsed.data.name,
      spec: payload.spec,
      viz: payload.viz,
    })
    .returning();
  res.status(201).json(created);
});

router.patch("/insights/widgets/:id", async (req, res): Promise<void> => {
  const params = UpdateInsightsWidgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInsightsWidgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const payload = parseWidgetPayload(parsed.data);
  if (payload.error) {
    res.status(400).json({ error: payload.error });
    return;
  }
  const user = currentUser(res);

  const updates: Partial<typeof insightsWidgetsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (payload.spec !== undefined) updates.spec = payload.spec;
  if (payload.viz !== undefined) updates.viz = payload.viz;
  if (parsed.data.dashboardId !== undefined) {
    if (
      parsed.data.dashboardId != null &&
      !(await assertDashboardOwned(parsed.data.dashboardId, user.id))
    ) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    updates.dashboardId = parsed.data.dashboardId;
  }

  // A body with nothing to change is a no-op, not a 500: `set({})` throws.
  if (Object.keys(updates).length === 0) {
    const [current] = await db
      .select()
      .from(insightsWidgetsTable)
      .where(ownedWidget(params.data.id, user.id));
    if (!current) {
      res.status(404).json({ error: "Widget not found" });
      return;
    }
    res.json(current);
    return;
  }

  const [updated] = await db
    .update(insightsWidgetsTable)
    .set(updates)
    .where(ownedWidget(params.data.id, user.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }
  res.json(updated);
});

router.delete("/insights/widgets/:id", async (req, res): Promise<void> => {
  const params = DeleteInsightsWidgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const user = currentUser(res);
  const [deleted] = await db
    .delete(insightsWidgetsTable)
    .where(ownedWidget(params.data.id, user.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }
  res.sendStatus(204);
});

router.post(
  "/insights/widgets/:id/duplicate",
  async (req, res): Promise<void> => {
    const params = DuplicateInsightsWidgetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = DuplicateInsightsWidgetBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const user = currentUser(res);
    // Visibility check, not just existence: the caller must own the widget
    // or the widget must sit on a dashboard shared with them — otherwise
    // this would let any user copy any private widget spec by id.
    const [source] = await db
      .select({ widget: insightsWidgetsTable })
      .from(insightsWidgetsTable)
      .leftJoin(
        insightsDashboardsTable,
        eq(insightsWidgetsTable.dashboardId, insightsDashboardsTable.id),
      )
      .where(
        and(
          eq(insightsWidgetsTable.id, params.data.id),
          or(
            eq(insightsWidgetsTable.ownerId, user.id),
            dashboardSharedWith(user.id),
          ),
        ),
      )
      .then((rows) => rows.map((r) => r.widget));
    if (!source) {
      res.status(404).json({ error: "Widget not found" });
      return;
    }
    // "Save as" defaults next to the source when the caller owns that
    // dashboard; otherwise the copy lands in the caller's library.
    const dashboardId =
      body.data.dashboardId !== undefined
        ? body.data.dashboardId
        : source.dashboardId != null &&
            (await assertDashboardOwned(source.dashboardId, user.id))
          ? source.dashboardId
          : null;
    if (dashboardId != null && !(await assertDashboardOwned(dashboardId, user.id))) {
      res.status(404).json({ error: "Dashboard not found" });
      return;
    }
    const [copy] = await db
      .insert(insightsWidgetsTable)
      .values({
        dashboardId,
        ownerId: user.id,
        name: body.data.name ?? `${source.name} (copy)`,
        spec: source.spec,
        viz: source.viz,
      })
      .returning();
    res.status(201).json(copy);
  },
);

// ---- Query + fields --------------------------------------------------------

/** Spec fingerprint for logs: enough to aggregate slow/failing shapes
 *  without logging user filter values. */
function specFingerprint(spec: WidgetSpec) {
  return {
    scope: spec.scope,
    reportType: spec.reportType,
    measure: `${spec.measure.agg}(${spec.measure.field})`,
    viewBy: spec.viewBy?.field,
    segmentBy: spec.segmentBy?.field,
  };
}

router.post(
  "/insights/query",
  insightsQueryRateLimiter,
  async (req, res): Promise<void> => {
    const parsed = RunInsightsQueryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    let spec;
    try {
      spec = migrateSpec(parsed.data.spec);
    } catch (err) {
      res
        .status(400)
        .json({ error: err instanceof Error ? err.message : "Invalid spec" });
      return;
    }

    const fingerprint = specFingerprint(spec);
    const startedAt = Date.now();
    try {
      const global = (parsed.data.globalFilters ?? null) as GlobalFilters | null;
      const { result, cached } = await runInsightsSpec(spec, global);
      logger.info(
        {
          reqId: req.id,
          insights: fingerprint,
          durationMs: Date.now() - startedAt,
          rows: result.meta.totalRows,
          cached,
        },
        "insights query",
      );
      res.json(result);
    } catch (err) {
      if (err instanceof InsightsQueryError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof AnalyticsBusyError) {
        res.status(503).json({ error: err.message });
        return;
      }
      logger.error(
        { err, insights: fingerprint, durationMs: Date.now() - startedAt },
        "insights query failed",
      );
      res.status(500).json({ error: "Query failed" });
    }
  },
);

// One round trip per board load instead of one per widget. Items succeed or
// fail independently (per-item `error`), aligned to the request by index.
// The limiter counts a batch as one request — acceptable because the row cap,
// the 30-item cap, the result cache and the analytics semaphore all bound the
// work behind it.
router.post(
  "/insights/query-batch",
  insightsQueryRateLimiter,
  async (req, res): Promise<void> => {
    const parsed = RunInsightsQueryBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const startedAt = Date.now();
    let cacheHits = 0;
    const results = await Promise.all(
      // The item index rides along so a failure in the logs points at ONE
      // widget, not "somewhere in the batch".
      parsed.data.items.map(async (item, index) => {
        let spec;
        try {
          spec = migrateSpec(item.spec);
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : "Invalid spec",
          };
        }
        try {
          const global = (item.globalFilters ?? null) as GlobalFilters | null;
          const { result, cached } = await runInsightsSpec(spec, global);
          if (cached) cacheHits++;
          return { result };
        } catch (err) {
          if (err instanceof InsightsQueryError || err instanceof AnalyticsBusyError) {
            return { error: err.message };
          }
          logger.error(
            { err, reqId: req.id, batchIndex: index, insights: specFingerprint(spec) },
            "insights batch item failed",
          );
          return { error: "Query failed" };
        }
      }),
    );
    logger.info(
      {
        reqId: req.id,
        insightsBatch: {
          items: results.length,
          failed: results.filter((r) => "error" in r).length,
          cacheHits,
        },
        durationMs: Date.now() - startedAt,
      },
      "insights query batch",
    );
    res.json({ results });
  },
);

router.get("/insights/fields", async (req, res): Promise<void> => {
  const parsed = ListInsightsFieldsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const fields = await listInsightsFields(parsed.data.scope);
  res.json({
    scope: parsed.data.scope,
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      kind: f.kind,
      filterable: f.filterable,
      groupable: f.groupable,
      measurable: f.measurable,
      options: f.options,
    })),
  });
});

export default router;
