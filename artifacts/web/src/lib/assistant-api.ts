// Ask AI data layer.
//
// Same-origin relative URL + cookie auth, like the other hand-rolled
// (non-codegen) endpoints.
//
// POST /api/assistant streams its answer as Server-Sent Events.
// Frame format: "event: <type>\ndata: <json-on-one-line>\n\n". Event types:
//   text_delta       { text }                             — incremental assistant text
//   tool_call        { toolName, input }                   — a tool call started
//   tool_result      { toolName, ok, data?, error? }        — a tool call finished
//   done             { reply, traces }                      — terminal, full final state
//   error            { message }                            — terminal, sent instead of done

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

// Must stay <= the server's MAX_HISTORY_TURNS (routes/assistant.ts) — the
// server rejects the whole request past that count, so the client caps
// first and lets the oldest turns drop instead of the request failing.
export const MAX_HISTORY_TURNS = 20;

export interface AssistantToolTrace {
  toolName: string;
  input: unknown;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AssistantResponse {
  reply: string;
  traces: AssistantToolTrace[];
}

export interface AssistantStreamCallbacks {
  onTextDelta?: (text: string) => void;
  onToolCall?: (toolName: string, input: unknown) => void;
  onToolResult?: (trace: AssistantToolTrace) => void;
}

interface AssistantErrorBody {
  error?: string;
}

interface SSEFrame {
  event: string;
  data: string;
}

/** Splits a raw SSE frame (everything between "\n\n" boundaries) into its event name and joined data payload. */
function parseSSEFrame(rawFrame: string): SSEFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/**
 * Applies one parsed frame: invokes the matching callback for incremental
 * events, returns the final AssistantResponse for "done", or throws for
 * "error" (both terminal). Unknown event names are ignored for forward
 * compatibility.
 */
function handleFrame(
  frame: SSEFrame,
  callbacks: AssistantStreamCallbacks,
): AssistantResponse | undefined {
  switch (frame.event) {
    // Incremental frames are best-effort: a single malformed payload is
    // dropped rather than allowed to reject the whole stream and discard the
    // text already rendered. Only the terminal frames below (done/error) fail
    // hard, since without a parseable one there is no answer to show.
    case "text_delta": {
      const payload = tryParseFrame<{ text: string }>(frame);
      if (payload) callbacks.onTextDelta?.(payload.text);
      return undefined;
    }
    case "tool_call": {
      const payload = tryParseFrame<{ toolName: string; input: unknown }>(frame);
      if (payload) callbacks.onToolCall?.(payload.toolName, payload.input);
      return undefined;
    }
    case "tool_result": {
      const payload = tryParseFrame<AssistantToolTrace>(frame);
      if (payload) callbacks.onToolResult?.(payload);
      return undefined;
    }
    case "done": {
      const payload = tryParseFrame<AssistantResponse>(frame);
      if (!payload) throw new Error("The assistant sent a malformed response.");
      return payload;
    }
    case "error": {
      const payload = tryParseFrame<{ message: string; code?: string }>(frame);
      throw new AssistantStreamError(
        payload?.message || "The assistant is temporarily unavailable.",
        payload?.code,
      );
    }
    default:
      return undefined;
  }
}

/**
 * An "error" event from the server. `code` names the failure so the page can
 * explain it in the reader's language (routes/assistant.ts lists the codes);
 * `message` is the server's English text.
 */
export class AssistantStreamError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AssistantStreamError";
  }
}

/** Parses a frame's JSON data payload, returning undefined (not throwing) on malformed JSON. */
function tryParseFrame<T>(frame: SSEFrame): T | undefined {
  try {
    return JSON.parse(frame.data) as T;
  } catch {
    console.warn(`Ask AI: dropped malformed "${frame.event}" frame`);
    return undefined;
  }
}

/**
 * Sends a message to the assistant and streams the reply. `callbacks` fire
 * incrementally as frames arrive; the returned promise resolves with the
 * full `{ reply, traces }` from the terminal "done" event (or rejects on
 * "error", a non-2xx initial response, or the fetch/stream itself failing,
 * e.g. via an aborted `signal`).
 */
export async function streamAssistantMessage(
  message: string,
  history: AssistantMessage[],
  callbacks: AssistantStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    credentials: "same-origin",
    body: JSON.stringify({ message, history }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as AssistantErrorBody | null;
    throw new Error(body?.error ?? `Assistant request failed (${res.status})`);
  }
  if (!res.body) {
    throw new Error("Assistant response had no body to stream.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AssistantResponse | undefined;

  try {
    readLoop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSSEFrame(rawFrame);
        if (frame) {
          const outcome = handleFrame(frame, callbacks);
          if (outcome) {
            result = outcome;
            break readLoop;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new Error("Assistant stream ended without a final response.");
  }
  return result;
}
