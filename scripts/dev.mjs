#!/usr/bin/env node
// `pnpm dev`: the API server and the frontend dev server together, with the
// repo-root `.env` loaded. The frontend proxies /api to the API server, so
// open http://localhost:$WEB_PORT (default 3210).
//
// The API server has no watch mode (it is build-then-run), so restart this
// after backend changes; the frontend hot-reloads.
import { spawn } from "node:child_process";
import { loadRootEnv, repoRoot } from "./env.mjs";

loadRootEnv();

for (const name of ["DATABASE_URL", "SESSION_SECRET"]) {
  if (!process.env[name]) {
    console.error(`${name} is not set. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Not 5000: macOS AirPlay Receiver listens there.
const apiPort = process.env.API_PORT || "5001";
const webPort = process.env.WEB_PORT || "3210";

const services = [
  {
    name: "api",
    color: 36,
    args: ["--filter", "@workspace/api-server", "run", "dev"],
    env: { PORT: apiPort },
  },
  {
    name: "web",
    color: 35,
    args: ["--filter", "@workspace/web", "run", "dev"],
    env: {
      PORT: webPort,
      BASE_PATH: process.env.BASE_PATH || "/",
      VITE_API_PROXY: `http://localhost:${apiPort}`,
    },
  },
];

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode == null) c.kill("SIGTERM");
  process.exitCode = code;
}

for (const s of services) {
  const child = spawn("pnpm", s.args, {
    cwd: repoRoot,
    env: { ...process.env, ...s.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = `\x1b[${s.color}m[${s.name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + "\n");
    });
  }
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${prefix}exited with code ${code}; stopping.`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

console.log(`Starting… open http://localhost:${webPort} once both are up.`);
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
