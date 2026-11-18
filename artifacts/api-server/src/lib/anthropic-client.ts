import Anthropic from "@anthropic-ai/sdk";

// The process's single Anthropic client.
//
// It lives here rather than inside the feature that first needed it (Ask AI, in
// assistant.ts) so any other caller shares it: two clients would mean two
// connection pools and two places deciding whether the key is present, for one
// credential that is either configured or is not.
//
// Memoized on purpose. The SDK client is cheap to build but holds keep-alive
// connections, and a per-call client would open a new one for every request.

/**
 * Bounds each individual Claude API call. Without it the SDK's ten-minute
 * default applies, which is far longer than any caller here is willing to wait.
 * Callers that loop (the assistant's tool loop) multiply this, so it is
 * deliberately well under a minute-scale budget rather than a generous one.
 */
export const ANTHROPIC_REQUEST_TIMEOUT_MS = 60_000;

let client: Anthropic | undefined;

/**
 * True when the API key is set.
 *
 * Every Anthropic-backed feature checks this BEFORE doing any work, so an
 * unconfigured deploy degrades visibly and makes zero upstream calls — the same
 * graceful-off shape as `isSlackConfigured()`.
 */
export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * The shared client.
 *
 * Throws when the key is unset, naming the calling feature so the message is
 * actionable rather than generic. Callers that must not throw should gate on
 * `anthropicConfigured()` first.
 */
export function getAnthropicClient(feature: string): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      `ANTHROPIC_API_KEY environment variable is required to use ${feature}.`,
    );
  }
  client = new Anthropic({ apiKey, timeout: ANTHROPIC_REQUEST_TIMEOUT_MS });
  return client;
}

/** Test seam: drop the memoized client so a changed env var takes effect. */
export function resetAnthropicClientForTests(): void {
  client = undefined;
}
