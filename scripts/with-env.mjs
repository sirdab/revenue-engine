#!/usr/bin/env node
// Runs a command with the repo-root `.env` loaded, if there is one:
//
//   node scripts/with-env.mjs pnpm --filter @workspace/db run migrate
//
// Variables already set in the shell win over the file, so CI and production
// (which never have a .env) behave exactly as before.
import { spawn } from "node:child_process";
import { loadRootEnv } from "./env.mjs";

loadRootEnv();

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/with-env.mjs <command> [args...]");
  process.exit(2);
}

const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
