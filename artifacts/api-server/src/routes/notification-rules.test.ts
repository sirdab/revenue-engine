import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Same harness shape as ab-invoicing.test.ts: the router pulls in `lib/auth` ->
// `@workspace/db`, which refuses to load without a DATABASE_URL. Every
// assertion below is answered by argument validation, which runs before any
// handler reaches Postgres — so nothing here opens a connection. The env has to
// be set before the module graph evaluates, hence the dynamic import.
process.env.DATABASE_URL ??= "postgres://notification-rules-test/unused";
const { default: notificationRulesRouter } = await import(
  "./notification-rules.ts"
);
const { default: adminAutomationsRouter } = await import(
  "./admin-automations.ts"
);
const { SetNotificationSubscriptionBody } = await import("@workspace/api-zod");

// The permission SHAPE is the thing under test here, because it is the whole
// reason this router exists. A CS teammate has to be able to subscribe
// themselves without an admin, while authoring stays admin-only — if that
// inverts, either the feature is useless (non-admins locked out) or a
// non-admin can rewrite what the whole team receives.

let baseUrl = "";
let isAdmin = false;
let server: Server;

before(async () => {
  const app = express();
  app.use(express.json());
  // Stands in for `requireAuth`, which has already run in production by the
  // time these routers see a request. Both roles are authenticated; the only
  // difference is `isAdmin`.
  app.use((_req, res, next) => {
    res.locals.user = { id: 7, name: "Test", isAdmin };
    next();
  });
  app.use(notificationRulesRouter);
  app.use(adminAutomationsRouter);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

// Authoring endpoints on the admin router. A non-admin reaching ANY of these
// would mean one person can change what the whole team receives.
const AUTHORING: { method: string; path: string; body?: unknown }[] = [
  { method: "GET", path: "/admin/automations" },
  {
    method: "POST",
    path: "/admin/automations",
    body: {
      name: "x",
      triggerEvent: "deal_updated",
      actionType: "post_notification",
      actionConfig: { message: "hi" },
    },
  },
  { method: "PATCH", path: "/admin/automations/1", body: { name: "y" } },
  { method: "DELETE", path: "/admin/automations/1" },
  { method: "POST", path: "/admin/automations/reorder", body: { ids: [1] } },
];

test("a non-admin is refused every authoring endpoint", async () => {
  isAdmin = false;
  for (const e of AUTHORING) {
    const { status } = await call(e.method, e.path, e.body);
    assert.equal(
      status,
      403,
      `${e.method} ${e.path} must be admin-only, got ${status}`,
    );
  }
});

test("subscribing validates without an admin flag", async () => {
  // The point of the whole router: a non-admin gets PAST the permission layer.
  // A 403 here means the CS teammate still cannot self-serve, which is the bug
  // this feature exists to fix. Validation rejects the malformed body with a
  // 400, which proves the request reached the handler.
  isAdmin = false;
  const { status } = await call(
    "PUT",
    "/notification-rules/1/subscription",
    { active: "yes" }, // wrong type on purpose — 400, not 403
  );
  assert.equal(status, 400, `expected validation, not a permission refusal`);
});

test("a non-numeric rule id is rejected rather than coerced", async () => {
  isAdmin = false;
  const { status } = await call("PUT", "/notification-rules/abc/subscription", {
    active: true,
  });
  assert.equal(status, 400);
});

test("a missing active flag is rejected", async () => {
  // `active` is required: an upsert with no state would silently default and
  // the user could not tell whether they had subscribed.
  isAdmin = false;
  const { status } = await call("PUT", "/notification-rules/1/subscription", {
    params: { days: 30 },
  });
  assert.equal(status, 400);
});

test("a body-supplied userId cannot reach the handler", async () => {
  // Nobody — admin included — can subscribe someone else, because no route
  // parameter or body field names a user. Asserted against the request schema
  // rather than by calling the route: a valid body gets past validation and
  // straight to Postgres, so an end-to-end call here would "pass" on a
  // connection error and prove nothing.
  //
  // The contract is that the parsed body carries no user identity at all, so
  // the handler has nothing but the session to write against.
  const parsed = SetNotificationSubscriptionBody.parse({
    active: true,
    userId: 999,
  });
  assert.equal(
    "userId" in parsed,
    false,
    "userId must be stripped by the schema, never forwarded to the handler",
  );
  assert.deepEqual(parsed, { active: true });
});
