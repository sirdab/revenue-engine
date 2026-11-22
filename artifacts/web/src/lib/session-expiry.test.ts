import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSessionExpiredError,
  isSessionExpiredEventException,
} from "./session-expiry";

function apiError(status: number, url: string) {
  return { name: "ApiError", status, url, message: `HTTP ${status} : Not authenticated` };
}

test("a 401 from an authenticated route is a lost session", () => {
  assert.equal(isSessionExpiredError(apiError(401, "https://crm.example.com/api/deals")), true);
  assert.equal(isSessionExpiredError(apiError(401, "/api/auth/me")), true);
});

test("the sign-in form's wrong-password 401 is not a lost session", () => {
  assert.equal(isSessionExpiredError(apiError(401, "https://crm.example.com/api/auth/login")), false);
  assert.equal(isSessionExpiredError(apiError(401, "/api/auth/login?x=1")), false);
});

test("other statuses and non-ApiErrors are not a lost session", () => {
  assert.equal(isSessionExpiredError(apiError(403, "/api/deals")), false);
  assert.equal(isSessionExpiredError(apiError(500, "/api/deals")), false);
  assert.equal(isSessionExpiredError(new Error("HTTP 401 : Not authenticated")), false);
  assert.equal(isSessionExpiredError(null), false);
  assert.equal(isSessionExpiredError("HTTP 401"), false);
});

test("a serialized Sentry exception for a lost session is recognised", () => {
  assert.equal(isSessionExpiredEventException("ApiError", "HTTP 401 : Not authenticated"), true);
  assert.equal(
    isSessionExpiredEventException("ApiError", "HTTP 401 Unauthorized: Not authenticated"),
    true,
  );
  assert.equal(
    isSessionExpiredEventException("ApiError", "HTTP 401 : Invalid email or password"),
    false,
  );
  assert.equal(isSessionExpiredEventException("ApiError", "HTTP 500 : Not authenticated"), false);
  assert.equal(isSessionExpiredEventException("TypeError", "HTTP 401 : Not authenticated"), false);
  assert.equal(isSessionExpiredEventException(undefined, undefined), false);
});
