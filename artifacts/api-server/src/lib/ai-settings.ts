import { clearSetting, getSetting, setSetting } from "./app-settings";
import { AI_PROVIDERS, AiProviderError, DEFAULT_MODELS, verifyApiKey, type AiConfig, type AiProvider } from "./ai-chat";
import { logger } from "./logger";
import { openSecret, sealSecret } from "./secret-box";

// The workspace's own AI connection (Settings → Integrations → AI assistant),
// which powers Ask AI. Each workspace brings its own OpenAI or Anthropic key,
// so its usage is billed to its own account. Kept in `app_settings` like the
// Slack connection: per tenant, and the key is write-only. Unlike Slack's
// token it is also encrypted at rest (secret-box.ts).
//
// A self-hosted install can instead set ANTHROPIC_API_KEY for the whole
// server. That is used only by a workspace that has not connected its own key;
// a workspace that has, and switched it off, gets no AI at all.

const PROVIDER_KEY = "ai_provider";
const API_KEY_KEY = "ai_api_key";
const MODEL_KEY = "ai_model";
const ENABLED_KEY = "ai_enabled";

const MAX_MODEL_LENGTH = 100;
const MAX_KEY_LENGTH = 500;

export interface AiSettingsView {
  provider: AiProvider | null;
  /** A key is stored and still readable. */
  keySet: boolean;
  /** A key is stored but can no longer be decrypted (SESSION_SECRET changed). */
  keyUnreadable: boolean;
  model: string | null;
  enabled: boolean;
  defaultModels: Record<AiProvider, string>;
  /** The server has its own key, used while this workspace has none. */
  serverKeyAvailable: boolean;
}

export interface AiSettingsUpdate {
  provider?: AiProvider;
  /** A new key; null clears it (and switches the assistant off). */
  apiKey?: string | null;
  /** null or "" falls back to the provider's default model. */
  model?: string | null;
  enabled?: boolean;
}

export class AiSettingsError extends Error {}

function isProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

function serverKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

async function readStored() {
  const [provider, sealedKey, model, enabled] = await Promise.all([
    getSetting(PROVIDER_KEY),
    getSetting(API_KEY_KEY),
    getSetting(MODEL_KEY),
    getSetting(ENABLED_KEY),
  ]);
  const apiKey = sealedKey ? openSecret(sealedKey) : null;
  if (sealedKey && !apiKey) {
    logger.warn("The workspace's AI key could not be decrypted; it has to be entered again");
  }
  return {
    provider: isProvider(provider) ? provider : null,
    sealedKeyPresent: Boolean(sealedKey),
    apiKey,
    model: model || null,
    enabled: enabled === "true",
  };
}

export async function getAiSettings(): Promise<AiSettingsView> {
  const s = await readStored();
  return {
    provider: s.provider,
    keySet: Boolean(s.apiKey),
    keyUnreadable: s.sealedKeyPresent && !s.apiKey,
    model: s.model,
    enabled: s.enabled && Boolean(s.apiKey),
    defaultModels: DEFAULT_MODELS,
    serverKeyAvailable: Boolean(serverKey()),
  };
}

/**
 * The connection Ask AI should use for the current workspace, or null when it
 * has none. The workspace's own key wins; the server key covers only a
 * workspace that never stored one.
 */
export async function resolveAiConfig(): Promise<AiConfig | null> {
  const s = await readStored();
  if (s.sealedKeyPresent) {
    if (!s.enabled || !s.apiKey || !s.provider) return null;
    return { provider: s.provider, apiKey: s.apiKey, model: s.model ?? DEFAULT_MODELS[s.provider] };
  }
  const key = serverKey();
  return key ? { provider: "anthropic", apiKey: key, model: DEFAULT_MODELS.anthropic } : null;
}

function checkKeyShape(provider: AiProvider, key: string): void {
  if (key.length > MAX_KEY_LENGTH || /\s/.test(key)) {
    throw new AiSettingsError("That doesn't look like an API key.");
  }
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    throw new AiSettingsError("An Anthropic API key starts with sk-ant-.");
  }
  if (provider === "openai" && (!key.startsWith("sk-") || key.startsWith("sk-ant-"))) {
    throw new AiSettingsError("An OpenAI API key starts with sk-.");
  }
}

/**
 * Applies an update. A new key is checked with the provider before it is
 * stored: a key the provider rejects is refused, so a typo is caught here
 * rather than on someone's first question.
 */
export async function updateAiSettings(input: AiSettingsUpdate): Promise<AiSettingsView> {
  const current = await readStored();

  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new AiSettingsError("Choose OpenAI or Anthropic.");
  }
  const provider = input.provider ?? current.provider;

  if (input.apiKey === null) {
    await Promise.all([clearSetting(API_KEY_KEY), setSetting(ENABLED_KEY, "false")]);
    if (input.provider) await setSetting(PROVIDER_KEY, input.provider);
    return getAiSettings();
  }

  const newKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const providerChanged = Boolean(input.provider && input.provider !== current.provider);
  if (providerChanged && !newKey && current.sealedKeyPresent) {
    // The stored key belongs to the other provider.
    throw new AiSettingsError("Enter an API key for the provider you chose.");
  }
  if (newKey) {
    if (!provider) throw new AiSettingsError("Choose OpenAI or Anthropic.");
    checkKeyShape(provider, newKey);
    try {
      await verifyApiKey(provider, newKey);
    } catch (err) {
      if (err instanceof AiProviderError && (err.status === 401 || err.status === 403)) {
        throw new AiSettingsError(
          provider === "openai" ? "OpenAI rejected this API key." : "Anthropic rejected this API key.",
        );
      }
      // The provider was unreachable or had a problem of its own: that says
      // nothing about the key, so it is stored and the Test button can retry.
      logger.warn({ err, provider }, "Could not verify the AI key; storing it unverified");
    }
  }

  if (input.model !== undefined) {
    const model = (input.model ?? "").trim();
    if (model.length > MAX_MODEL_LENGTH || /\s/.test(model)) {
      throw new AiSettingsError("That doesn't look like a model name.");
    }
  }

  const willHaveKey = Boolean(newKey) || (Boolean(current.apiKey) && !providerChanged);
  if (input.enabled && !willHaveKey) {
    throw new AiSettingsError("Add an API key before switching the assistant on.");
  }

  const writes: Promise<void>[] = [];
  if (provider && provider !== current.provider) writes.push(setSetting(PROVIDER_KEY, provider));
  if (newKey) writes.push(setSetting(API_KEY_KEY, sealSecret(newKey)));
  if (input.model !== undefined) {
    const model = (input.model ?? "").trim();
    writes.push(model ? setSetting(MODEL_KEY, model) : clearSetting(MODEL_KEY));
  } else if (providerChanged) {
    // A model name belongs to one provider.
    writes.push(clearSetting(MODEL_KEY));
  }
  // Connecting a key switches the assistant on unless the request says otherwise.
  const enabled = input.enabled ?? (newKey ? true : undefined);
  if (enabled !== undefined) writes.push(setSetting(ENABLED_KEY, enabled ? "true" : "false"));
  await Promise.all(writes);

  return getAiSettings();
}

/** Re-checks the stored key with its provider (the settings card's Test button). */
export async function testAiConnection(): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await readStored();
  if (!s.provider || !s.apiKey) return { ok: false, error: "No API key is stored." };
  try {
    await verifyApiKey(s.provider, s.apiKey);
    return { ok: true };
  } catch (err) {
    if (err instanceof AiProviderError && (err.status === 401 || err.status === 403)) {
      return { ok: false, error: "The provider rejected the stored API key." };
    }
    logger.warn({ err }, "AI connection test failed");
    return { ok: false, error: "Couldn't reach the provider. Try again in a moment." };
  }
}
