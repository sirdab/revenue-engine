import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, teamsTable, dealsTable } from "@workspace/db";
import {
  ListUsersResponse,
  ListUserOptionsResponse,
  CreateUserBody,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  ResendUserCredentialsParams,
  ResendUserCredentialsResponse,
} from "@workspace/api-zod";
import {
  requireAdmin,
  hashPassword,
  toSafeUser,
  validatePasswordStrength,
  generateTempPassword,
  currentUser,
} from "../lib/auth";
import { APP_TIMEZONE } from "../lib/assistant-dates";
import { sendAccountCredentialsEmail, appBaseUrl } from "../lib/email";
import { isMailerConfigured } from "../lib/mailer";
import { logger } from "../lib/logger";
import { logDealChanges } from "../lib/change-events";

// Thrown inside the deactivation transaction when the user still owns open
// deals but no valid reassignment target was given — rolls the tx back and
// maps to a 409 so no user is ever deactivated still owning open deals.
class DeactivateNeedsReassign extends Error {
  constructor(public openDealsCount: number) {
    super("Deactivation requires reassigning open deals.");
  }
}

const router: IRouter = Router();

// Lightweight id+name+team list for assignment pickers (deal owner, account
// manager, activity assignee, @mentions) — available to every authenticated
// user. Deliberately excludes email/phone/isAdmin/lastLogin: those stay on
// the admin-only /users surface. Registered BEFORE the admin guard below so
// it stays out of the admin-only user-management surface.
router.get("/users/options", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      teamName: teamsTable.name,
    })
    .from(usersTable)
    .leftJoin(teamsTable, eq(usersTable.teamId, teamsTable.id))
    .where(eq(usersTable.activeFlag, true))
    .orderBy(usersTable.name);
  res.json(
    ListUserOptionsResponse.parse(
      rows.map((r) => ({ ...r, teamName: r.teamName ?? null })),
    ),
  );
});

// All user-management routes are admin-only. Scope the guard to the `/users`
// path: this router is mounted at the root (`router.use(usersRouter)`), so a
// path-less `router.use(requireAdmin)` would run for EVERY request that flows
// through it — including routers mounted after this one (search,
// import, …) — and 403 non-admins out of those features.
router.use("/users", requireAdmin);

router.get("/users", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ user: usersTable, teamName: teamsTable.name })
    .from(usersTable)
    .leftJoin(teamsTable, eq(usersTable.teamId, teamsTable.id))
    .orderBy(usersTable.name);
  res.json(
    ListUsersResponse.parse(
      rows.map((r) => ({ ...toSafeUser(r.user), teamName: r.teamName ?? null })),
    ),
  );
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const pwError = validatePasswordStrength(d.password);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }
  const email = d.email.toLowerCase().trim();
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }
  const passwordHash = await hashPassword(d.password);
  const [created] = await db
    .insert(usersTable)
    .values({
      name: d.name,
      email,
      passwordHash,
      phone: d.phone ?? null,
      roleId: d.roleId ?? null,
      isAdmin: d.isAdmin ?? false,
      activeFlag: d.activeFlag ?? true,
      defaultCurrency: d.defaultCurrency ?? "USD",
      timezoneName: d.timezoneName ?? APP_TIMEZONE,
    })
    .returning();

  // Best-effort welcome email with the credentials the admin set. A delivery
  // failure must never fail account creation — it's logged and the admin can
  // resend from the users screen.
  if (d.sendInvite !== false) {
    try {
      await sendAccountCredentialsEmail({
        to: created.email,
        name: created.name,
        email: created.email,
        password: d.password,
        loginUrl: `${appBaseUrl()}/login`,
        isNew: true,
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, userId: created.id },
        "User created but welcome email could not be sent",
      );
    }
  }

  // A freshly created user has no team yet — echo teamName so every
  // User-shaped response carries the field consistently.
  res.status(201).json(
    GetUserResponse.parse({ ...toSafeUser(created), teamName: null }),
  );
});

// Reset a user's password to a fresh temporary one and email it to them. The
// password is only rotated once the email is sent, so a delivery failure never
// locks the user out of their existing password.
router.post(
  "/users/:id/resend-credentials",
  async (req, res): Promise<void> => {
    const params = ResendUserCredentialsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!isMailerConfigured()) {
      res.status(503).json({ error: "Email delivery is not configured." });
      return;
    }

    const tempPassword = generateTempPassword();
    try {
      await sendAccountCredentialsEmail({
        to: user.email,
        name: user.name,
        email: user.email,
        password: tempPassword,
        loginUrl: `${appBaseUrl()}/login`,
        isNew: false,
      });
    } catch (err) {
      const detail = (err as Error).message;
      logger.error(
        { err: detail, userId: user.id },
        "Failed to send login details email",
      );
      // Admin-only route: surface the underlying cause (e.g. an unverified SES
      // sender or sandbox recipient) so it can be fixed without digging logs.
      res.status(503).json({ error: `Could not send the email: ${detail}` });
      return;
    }

    // Only persist the new password after the email was delivered. Bumping
    // passwordChangedAt signs out any existing sessions for that user.
    await db
      .update(usersTable)
      .set({
        passwordHash: await hashPassword(tempPassword),
        passwordChangedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    res.json(
      ResendUserCredentialsResponse.parse({
        message: `Login details sent to ${user.email}.`,
      }),
    );
  },
);

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({ user: usersTable, teamName: teamsTable.name })
    .from(usersTable)
    .leftJoin(teamsTable, eq(usersTable.teamId, teamsTable.id))
    .where(eq(usersTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(
    GetUserResponse.parse({ ...toSafeUser(row.user), teamName: row.teamName ?? null }),
  );
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;

  const [targetRow] = await db
    .select({ user: usersTable, teamName: teamsTable.name })
    .from(usersTable)
    .leftJoin(teamsTable, eq(usersTable.teamId, teamsTable.id))
    .where(eq(usersTable.id, params.data.id));
  if (!targetRow) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const target = targetRow.user;
  // The team shown in the response: unchanged unless this request touches teamId.
  let teamName: string | null = targetRow.teamName ?? null;

  const me = currentUser(res);

  // An admin must never be able to lock themselves out.
  if (target.id === me.id && d.activeFlag === false) {
    res.status(409).json({ error: "You cannot deactivate your own account." });
    return;
  }
  if (target.id === me.id && d.isAdmin === false) {
    res.status(409).json({ error: "You cannot remove your own admin access." });
    return;
  }

  // The system must always retain at least one active admin.
  const losesAdminAccess =
    target.isAdmin &&
    target.activeFlag &&
    (d.activeFlag === false || d.isAdmin === false);
  if (losesAdminAccess) {
    const activeAdmins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(eq(usersTable.isAdmin, true), eq(usersTable.activeFlag, true)),
      );
    const remaining = activeAdmins.filter((u) => u.id !== target.id);
    if (remaining.length === 0) {
      res.status(409).json({ error: "At least one active admin is required." });
      return;
    }
  }

  // A departing rep may still own deals nobody else is working. Block the
  // deactivation until the admin names a replacement owner, then reassign
  // and deactivate together in one transaction below. Archived deals are
  // included (unlike the bulk owner-reassignment action, which skips them)
  // so a deactivated user never remains attached to anything, even a
  // read-only/archived record.
  const deactivating = target.activeFlag && d.activeFlag === false;
  let openDealCount = 0;
  if (deactivating) {
    const [openDeals] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dealsTable)
      .where(and(eq(dealsTable.ownerId, target.id), eq(dealsTable.status, "open")));
    openDealCount = openDeals?.count ?? 0;

    if (openDealCount > 0) {
      if (d.reassignOwnerId == null) {
        res.status(409).json({
          error: `${target.name} owns ${openDealCount} open deal(s). Choose a user to reassign them to.`,
          needsReassign: true,
          openDealsCount: openDealCount,
        });
        return;
      }
      const [reassignTarget] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, d.reassignOwnerId));
      if (
        !reassignTarget ||
        !reassignTarget.activeFlag ||
        reassignTarget.id === target.id
      ) {
        res
          .status(400)
          .json({ error: "Reassignment target must be another active user." });
        return;
      }
    }
  }

  // Reject email collisions before attempting the update.
  if (d.email !== undefined) {
    const email = d.email.toLowerCase().trim();
    if (email !== target.email) {
      const [dupe] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (dupe) {
        res
          .status(409)
          .json({ error: "A user with this email already exists" });
        return;
      }
    }
  }

  // Resolve the team assignment: null clears it; a number must reference a real
  // team (a bad id is a 400, never a 500 from an FK violation). The same lookup
  // yields the name we echo back, so no separate post-update query is needed.
  if (d.teamId !== undefined) {
    if (d.teamId === null) {
      teamName = null;
    } else {
      const [team] = await db
        .select({ id: teamsTable.id, name: teamsTable.name })
        .from(teamsTable)
        .where(eq(teamsTable.id, d.teamId));
      if (!team) {
        res.status(400).json({ error: "Team not found" });
        return;
      }
      teamName = team.name;
    }
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (d.name !== undefined) updates.name = d.name;
  if (d.email !== undefined) updates.email = d.email.toLowerCase().trim();
  if (d.phone !== undefined) updates.phone = d.phone;
  if (d.roleId !== undefined) updates.roleId = d.roleId;
  if (d.isAdmin !== undefined) updates.isAdmin = d.isAdmin;
  if (d.activeFlag !== undefined) updates.activeFlag = d.activeFlag;
  if (d.defaultCurrency !== undefined)
    updates.defaultCurrency = d.defaultCurrency;
  if (d.timezoneName !== undefined) updates.timezoneName = d.timezoneName;
  if (d.teamId !== undefined) updates.teamId = d.teamId;
  if (d.password !== undefined) {
    const pwError = validatePasswordStrength(d.password);
    if (pwError) {
      res.status(400).json({ error: pwError });
      return;
    }
    updates.passwordHash = await hashPassword(d.password);
    // Force re-auth on all existing sessions when an admin changes a password.
    updates.passwordChangedAt = new Date();
  }

  const now = new Date();
  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      // Authoritative deal handling: whenever we're deactivating, re-derive and
      // lock the CURRENT open-deal set inside the transaction — NOT gated on the
      // pre-transaction count, which a deal created/reassigned to this user
      // between the check and this commit would make stale, leaving a
      // deactivated user still owning an open deal.
      if (deactivating) {
        const before = await tx
          .select()
          .from(dealsTable)
          .where(
            and(
              eq(dealsTable.ownerId, target.id),
              eq(dealsTable.status, "open"),
            ),
          )
          .for("update");
        if (before.length) {
          // Must have a valid, active, other user to receive the deals — else
          // roll back rather than orphan them on a deactivated owner.
          if (d.reassignOwnerId == null || d.reassignOwnerId === target.id) {
            throw new DeactivateNeedsReassign(before.length);
          }
          const [rt] = await tx
            .select({ id: usersTable.id, activeFlag: usersTable.activeFlag })
            .from(usersTable)
            .where(eq(usersTable.id, d.reassignOwnerId));
          if (!rt || !rt.activeFlag) {
            throw new DeactivateNeedsReassign(before.length);
          }
          await tx
            .update(dealsTable)
            .set({ ownerId: d.reassignOwnerId })
            .where(
              inArray(
                dealsTable.id,
                before.map((b) => b.id),
              ),
            );
          await logDealChanges(
            tx,
            before.map((b) => ({
              before: b,
              patch: { ownerId: d.reassignOwnerId! },
            })),
            { changedBy: me.id, changedAt: now },
          );
        }
      }
      const [row] = await tx
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, params.data.id))
        .returning();
      return row;
    });
  } catch (err) {
    if (err instanceof DeactivateNeedsReassign) {
      res.status(409).json({
        error: `${target.name} owns ${err.openDealsCount} open deal(s). Choose an active user to reassign them to.`,
        needsReassign: true,
        openDealsCount: err.openDealsCount,
      });
      return;
    }
    throw err;
  }
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(UpdateUserResponse.parse({ ...toSafeUser(updated), teamName }));
});

export default router;
