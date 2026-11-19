// Recognising an expired session.
//
// Every authenticated route answers 401 "Not authenticated" once the session
// cookie is gone or revoked (signed out in another tab, password changed,
// user deactivated). That is an expected state, not a bug: the app should
// send the user back to sign-in, and Sentry should not page anyone over it.
//
// The one 401 that is NOT a lost session is the sign-in form's own
// "Invalid email or password", which the login page shows inline.
//
// Duck-typed on the ApiError shape (name + status + url) rather than
// `instanceof`, so it stays a pure function the node test runner can import
// without pulling in the generated client.

const LOGIN_PATH = /\/auth\/login(?:[?#]|$)/;

export function isSessionExpiredError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; status?: unknown; url?: unknown };
  if (e.name !== "ApiError" || e.status !== 401) return false;
  return !(typeof e.url === "string" && LOGIN_PATH.test(e.url));
}

/**
 * The same check for a Sentry event that lost its original exception object
 * (only the serialized type and message survive). The ApiError message for a
 * lost session is "HTTP 401 <statusText>: Not authenticated".
 */
export function isSessionExpiredEventException(
  type: string | undefined,
  value: string | undefined,
): boolean {
  return (
    type === "ApiError" &&
    typeof value === "string" &&
    /^HTTP 401\b/.test(value) &&
    /not authenticated/i.test(value)
  );
}
