import Anthropic from "@anthropic-ai/sdk";

// One model turn, on either provider a workspace can connect: Anthropic
// (Claude) or OpenAI. Ask AI's tool loop (assistant.ts) speaks only the
// neutral shapes below; each adapter translates them to its provider's API and
// back. Nothing here knows about the CRM.

export type AiProvider = "anthropic" | "openai";

export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai"];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
};

/**
 * Bounds each individual provider call. Callers that loop (the assistant's
 * tool loop) multiply this, so it is deliberately well under a minute-scale
 * budget rather than a generous one.
 */
export const AI_REQUEST_TIMEOUT_MS = 60_000;

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultPart {
  id: string;
  content: string;
  isError?: boolean;
}

export type ChatMessage =
  | { role: "user"; text: string; cacheMark?: boolean }
  | { role: "assistant"; text: string; toolCalls?: ToolCall[]; cacheMark?: boolean }
  | { role: "tool"; results: ToolResultPart[] };

export interface TurnRequest {
  /** Identical on every request, so providers that cache a prefix can reuse it. */
  stableSystem: string;
  /** Changes per request (today's date, the signed-in user, pre-fetched data). */
  dynamicSystem?: string;
  tools: ToolDef[];
  messages: ChatMessage[];
  maxTokens: number;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export type TurnStop = "end" | "tool_use" | "truncated" | "refusal";

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stop: TurnStop;
  /** The provider's own stop reason, for logs. */
  rawStop: string | null;
}

/** A provider answered with an error status (a rejected key, a bad request, rate limiting). */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProvider,
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function runTurn(config: AiConfig, req: TurnRequest): Promise<TurnResult> {
  return config.provider === "openai" ? runOpenAiTurn(config, req) : runAnthropicTurn(config, req);
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

// One client per key, reused across requests for its keep-alive connections.
// Bounded so a long-running process serving many workspaces does not grow
// without limit; the oldest entry goes first.
const anthropicClients = new Map<string, Anthropic>();
const MAX_CLIENTS = 200;

function anthropicClient(apiKey: string): Anthropic {
  let client = anthropicClients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey, timeout: AI_REQUEST_TIMEOUT_MS });
    if (anthropicClients.size >= MAX_CLIENTS) {
      anthropicClients.delete(anthropicClients.keys().next().value!);
    }
    anthropicClients.set(apiKey, client);
  }
  return client;
}

// The stable system prompt, the end of the incoming history and the live
// message are cache breakpoints: a multi-iteration tool loop, and later turns
// of the same chat, reuse that prefix instead of reprocessing it.
const CACHE_CONTROL: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {}),
        })),
      };
    }
    if (m.role === "user") {
      return m.cacheMark
        ? { role: "user", content: [{ type: "text", text: m.text, cache_control: CACHE_CONTROL }] }
        : { role: "user", content: m.text };
    }
    const content: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
    // The API rejects an empty text block, so a tool-only turn has none.
    if (m.text) {
      content.push({ type: "text", text: m.text, ...(m.cacheMark ? { cache_control: CACHE_CONTROL } : {}) });
    }
    for (const call of m.toolCalls ?? []) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    return { role: "assistant", content };
  });
}

async function runAnthropicTurn(config: AiConfig, req: TurnRequest): Promise<TurnResult> {
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: req.stableSystem, cache_control: CACHE_CONTROL },
  ];
  if (req.dynamicSystem) system.push({ type: "text", text: req.dynamicSystem });

  try {
    const stream = anthropicClient(config.apiKey).messages.stream(
      {
        model: config.model as Anthropic.Model,
        max_tokens: req.maxTokens,
        system,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
        messages: toAnthropicMessages(req.messages),
      },
      { signal: req.signal },
    );
    if (req.onTextDelta) stream.on("text", (delta) => req.onTextDelta!(delta));
    const response = await stream.finalMessage();

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const rawStop = response.stop_reason as string | null;
    return { text, toolCalls, stop: anthropicStop(rawStop), rawStop };
  } catch (err) {
    if (err instanceof Anthropic.APIError && !(err instanceof Anthropic.APIUserAbortError)) {
      throw new AiProviderError("anthropic", err.status, err.message);
    }
    throw err;
  }
}

function anthropicStop(reason: string | null): TurnStop {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "refusal";
    case "max_tokens":
    case "model_context_window_exceeded":
    case "pause_turn":
      return "truncated";
    default:
      return "end";
  }
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions, streamed). Called with fetch rather than the SDK:
// one endpoint, and the workspace keeps its dependency list short.
// ---------------------------------------------------------------------------

const OPENAI_BASE = "https://api.openai.com/v1";

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function toOpenAiMessages(req: Pick<TurnRequest, "stableSystem" | "dynamicSystem" | "messages">): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: req.stableSystem }];
  if (req.dynamicSystem) out.push({ role: "system", content: req.dynamicSystem });
  for (const m of req.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      // One message per result; a failed tool says so in its content, since
      // the API has no error flag on a tool message.
      for (const r of m.results) {
        out.push({
          role: "tool",
          tool_call_id: r.id,
          content: r.isError ? `Error: ${r.content}` : r.content,
        });
      }
    }
  }
  return out;
}

/** Folds the streamed chunks of one completion into a turn result. */
export class OpenAiStreamAccumulator {
  private text = "";
  private refusal = "";
  private finish: string | null = null;
  private calls: { id: string; name: string; args: string }[] = [];

  constructor(private readonly onTextDelta?: (text: string) => void) {}

  push(chunk: unknown): void {
    const choice = (chunk as { choices?: unknown[] })?.choices?.[0] as
      | {
          delta?: {
            content?: string | null;
            refusal?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }
      | undefined;
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (delta.content) {
      this.text += delta.content;
      this.onTextDelta?.(delta.content);
    }
    if (delta.refusal) this.refusal += delta.refusal;
    for (const tc of delta.tool_calls ?? []) {
      const slot = (this.calls[tc.index] ??= { id: "", name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
    }
    if (choice.finish_reason) this.finish = choice.finish_reason;
  }

  result(): TurnResult {
    const toolCalls: ToolCall[] = this.calls
      .filter((c) => c && c.name)
      .map((c) => ({ id: c.id, name: c.name, input: parseArgs(c.args) }));
    let stop: TurnStop;
    if (this.refusal || this.finish === "content_filter") stop = "refusal";
    else if (this.finish === "length") stop = "truncated";
    else if (toolCalls.length) stop = "tool_use";
    else stop = "end";
    return { text: this.text.trim(), toolCalls, stop, rawStop: this.finish };
  }
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Truncated or malformed arguments: the tool's own input validation
    // reports it back to the model, which can retry.
    return { _unparsedArguments: raw };
  }
}

async function openAiError(res: Response): Promise<AiProviderError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new AiProviderError(
    "openai",
    res.status,
    body?.error?.message ?? `OpenAI request failed (${res.status})`,
  );
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function runOpenAiTurn(config: AiConfig, req: TurnRequest): Promise<TurnResult> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: toOpenAiMessages(req),
      tools: req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      // Reasoning models spend part of this budget thinking before they
      // write, so it is larger than the visible answer needs.
      max_completion_tokens: req.maxTokens,
      stream: true,
    }),
    signal: withTimeout(req.signal),
  });
  if (!res.ok || !res.body) throw await openAiError(res);

  const acc = new OpenAiStreamAccumulator(req.onTextDelta);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return acc.result();
      acc.push(JSON.parse(data));
    }
  }
  return acc.result();
}

// ---------------------------------------------------------------------------
// Checking a key
// ---------------------------------------------------------------------------

/**
 * Asks the provider whether it accepts this key, by listing models: no tokens
 * spent. Resolves on success; throws AiProviderError with the provider's
 * status (401/403 for a rejected key) otherwise.
 */
export async function verifyApiKey(provider: AiProvider, apiKey: string): Promise<void> {
  const res =
    provider === "openai"
      ? await fetch(`${OPENAI_BASE}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(15_000),
        });
  if (res.ok) return;
  if (provider === "openai") throw await openAiError(res);
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new AiProviderError(
    "anthropic",
    res.status,
    body?.error?.message ?? `Anthropic request failed (${res.status})`,
  );
}
