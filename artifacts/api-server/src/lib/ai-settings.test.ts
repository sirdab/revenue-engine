import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Which key Ask AI uses, and what an admin may store. The settings table and
// the provider's key check are mocked at the seam (needs
// --experimental-test-module-mocks, set in the package's test script).

process.env.SESSION_SECRET = "test-session-secret";

const store = new Map<string, string>();
/** Keys the mocked provider rejects with a 401. */
const rejected = new Set<string>();

let mod: typeof import("./ai-settings");
let seal: typeof import("./secret-box").sealSecret;

before(async () => {
  mock.module("./app-settings", {
    namedExports: {
      getSetting: async (k: string) => store.get(k) ?? null,
      setSetting: async (k: string, v: string) => void store.set(k, v),
      clearSetting: async (k: string) => void store.delete(k),
    },
  });
  mock.module("./logger", { namedExports: { logger: { warn() {}, error() {}, info() {} } } });
  const chat = await import("./ai-chat");
  mock.module("./ai-chat", {
    namedExports: {
      ...chat,
      verifyApiKey: async (provider: "openai" | "anthropic", key: string) => {
        if (rejected.has(key)) throw new chat.AiProviderError(provider, 401, "invalid key");
      },
    },
  });
  mod = await import("./ai-settings");
  seal = (await import("./secret-box")).sealSecret;
});

beforeEach(() => {
  store.clear();
  rejected.clear();
  delete process.env.ANTHROPIC_API_KEY;
});

test("no key anywhere: no assistant", async () => {
  assert.equal(await mod.resolveAiConfig(), null);
});

test("the server key covers a workspace that never connected one", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-server";
  assert.deepEqual(await mod.resolveAiConfig(), {
    provider: "anthropic",
    apiKey: "sk-ant-server",
    model: "claude-sonnet-5",
  });
});

test("connecting an OpenAI key stores it encrypted, switches it on, and wins over the server key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-server";
  const view = await mod.updateAiSettings({ provider: "openai", apiKey: "sk-proj-abc" });
  assert.equal(view.keySet, true);
  assert.equal(view.enabled, true);
  assert.ok(!store.get("ai_api_key")!.includes("sk-proj-abc"));
  assert.deepEqual(await mod.resolveAiConfig(), { provider: "openai", apiKey: "sk-proj-abc", model: "gpt-5" });

  await mod.updateAiSettings({ model: "gpt-5-mini" });
  assert.equal((await mod.resolveAiConfig())?.model, "gpt-5-mini");
});

test("switching a connected workspace off gives no assistant, even with a server key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-server";
  await mod.updateAiSettings({ provider: "anthropic", apiKey: "sk-ant-mine" });
  await mod.updateAiSettings({ enabled: false });
  assert.equal(await mod.resolveAiConfig(), null);
});

test("a key the provider rejects, or in the wrong shape, is not stored", async () => {
  rejected.add("sk-bad");
  await assert.rejects(mod.updateAiSettings({ provider: "openai", apiKey: "sk-bad" }), /rejected/);
  await assert.rejects(mod.updateAiSettings({ provider: "anthropic", apiKey: "sk-proj-x" }), /sk-ant-/);
  await assert.rejects(mod.updateAiSettings({ provider: "openai", apiKey: "sk-ant-x" }), /OpenAI/);
  assert.equal(store.has("ai_api_key"), false);
});

test("changing provider needs a new key, and drops the old model", async () => {
  await mod.updateAiSettings({ provider: "openai", apiKey: "sk-proj-abc", model: "gpt-5-mini" });
  await assert.rejects(mod.updateAiSettings({ provider: "anthropic" }), /API key/);
  await mod.updateAiSettings({ provider: "anthropic", apiKey: "sk-ant-new" });
  assert.deepEqual(await mod.resolveAiConfig(), {
    provider: "anthropic",
    apiKey: "sk-ant-new",
    model: "claude-sonnet-5",
  });
});

test("clearing the key switches the assistant off", async () => {
  await mod.updateAiSettings({ provider: "openai", apiKey: "sk-proj-abc" });
  const view = await mod.updateAiSettings({ apiKey: null });
  assert.equal(view.keySet, false);
  assert.equal(view.enabled, false);
  assert.equal(await mod.resolveAiConfig(), null);
});

test("a key sealed under an old SESSION_SECRET reads as unreadable, not as a key", async () => {
  process.env.SESSION_SECRET = "the-old-secret";
  store.set("ai_api_key", seal("sk-proj-abc"));
  process.env.SESSION_SECRET = "test-session-secret";
  store.set("ai_provider", "openai");
  store.set("ai_enabled", "true");
  const view = await mod.getAiSettings();
  assert.equal(view.keySet, false);
  assert.equal(view.keyUnreadable, true);
  assert.equal(await mod.resolveAiConfig(), null);
});
