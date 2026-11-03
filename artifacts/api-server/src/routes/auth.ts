import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  ForgotPasswordBody,
  ResetPasswordBody,
} from "@workspace/api-zod";
import {
  verifyPasswordOrDummy,
  hashPassword,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  toSafeUser,
  currentUser,
  validatePasswordStrength,
  createResetToken,
  hashResetToken,
} from "../lib/auth";
import { sendPasswordResetEmail, appBaseUrl } from "../lib/email";
import { logger } from "../lib/logger";
import {
  loginRateLimiter,
  loginIpRateLimiter,
  forgotPasswordRateLimiter,
} from "../lib/rate-limit";

const router: IRouter = Router();

router.post(
  "/auth/login",
  loginIpRateLimiter,
  loginRateLimiter,
  async (req, res): Promise<void> => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const email = parsed.data.email.toLowerCase().trim();
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    // A missing or inactive account still pays for scrypt (against a dummy
    // hash), so the response time does not say whether the email exists.
    const account = user && user.activeFlag ? user : null;
    const ok = await verifyPasswordOrDummy(parsed.data.password, account?.passwordHash);
    if (!account || !ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const now = new Date();
    await db
      .update(usersTable)
      .set({ lastLogin: now })
      .where(eq(usersTable.id, account.id));

    setSessionCookie(res, account.id, account.passwordChangedAt);
    res.json(LoginResponse.parse(toSafeUser({ ...account, lastLogin: now })));
  },
);

router.post("/auth/logout", async (_req, res): Promise<void> => {
  clearSessionCookie(res);
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, async (_req, res): Promise<void> => {
  const user = currentUser(res);
  res.json(GetCurrentUserResponse.parse(user));
});

// Always returns a generic 200 so callers cannot tell whether an account exists.
router.post(
  "/auth/forgot-password",
  forgotPasswordRateLimiter,
  async (req, res): Promise<void> => {
    const parsed = ForgotPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const email = parsed.data.email.toLowerCase().trim();
    const generic = {
      message:
        "If an account exists for that email, a password reset link is on its way.",
    };

    // Reply BEFORE looking the account up: the token writes and the SMTP round
    // trip only happen for a real account, so awaiting them would let the
    // response time say whether the email exists.
    res.json(generic);
    void issuePasswordReset({
      email,
      requestedIp: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    }).catch((err) => {
      logger.error({ err }, "Failed to issue password reset");
    });
  },
);

async function issuePasswordReset(input: {
  email: string;
  requestedIp: string | null;
  userAgent: string | null;
}): Promise<void> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, input.email));
  if (!user || !user.activeFlag) return;

  // Invalidate any outstanding tokens before issuing a fresh one.
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  const { raw, hash, expiresAt } = createResetToken();
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash: hash,
    expiresAt,
    requestedIp: input.requestedIp,
    userAgent: input.userAgent,
  });

  const resetUrl = `${appBaseUrl()}/reset-password?token=${raw}`;
  await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl,
  });
}

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const pwError = validatePasswordStrength(parsed.data.password);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }

  const tokenHash = hashResetToken(parsed.data.token);
  const [token] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    res.status(400).json({
      error: "This reset link is invalid or has expired. Please request a new one.",
    });
    return;
  }

  const newHash = await hashPassword(parsed.data.password);
  const now = new Date();
  let claimed = false;
  await db.transaction(async (tx) => {
    // Atomically claim the token: only the request that flips usedAt from NULL
    // wins, so a token can never reset a password more than once even under
    // concurrent requests racing on the same link.
    const rows = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokensTable.id, token.id),
          isNull(passwordResetTokensTable.usedAt),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });
    if (rows.length === 0) return; // lost the race — token already consumed
    claimed = true;
    // Updating passwordChangedAt invalidates every existing session for the user.
    await tx
      .update(usersTable)
      .set({ passwordHash: newHash, passwordChangedAt: now })
      .where(eq(usersTable.id, rows[0].userId));
  });

  if (!claimed) {
    res.status(400).json({
      error: "This reset link is invalid or has expired. Please request a new one.",
    });
    return;
  }

  res.json({ message: "Your password has been updated. You can now sign in." });
});

router.get(
  "/auth/reset-password/validate",
  async (req, res): Promise<void> => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.json({ valid: false });
      return;
    }
    const tokenHash = hashResetToken(token);
    const [row] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    const valid =
      !!row && !row.usedAt && row.expiresAt.getTime() >= Date.now();
    res.json({ valid });
  },
);

export default router;
