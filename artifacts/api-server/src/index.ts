import "./lib/instrument";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureNativeColumnFields } from "./lib/deal-fields";
import { forEachTenant } from "./lib/tenants";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Best-effort: the server must still boot if the registry seed fails (e.g.
// during a brief DB outage); the seed is idempotent and re-runs next start.
// New workspaces are seeded at sign-up; this backfills any added since.
void forEachTenant("Registering native column deal fields", () =>
  ensureNativeColumnFields(),
).catch((err) =>
  logger.error({ err }, "Failed to register native column deal fields"),
);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
