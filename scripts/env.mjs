import { existsSync } from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");

/** Loads `<repo>/.env` into process.env without overriding what is already set. */
export function loadRootEnv() {
  const file = path.join(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
