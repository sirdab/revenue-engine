import Anthropic from "@anthropic-ai/sdk";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  runAssistant,
  type AssistantMessage,
  type AssistantReply,
} from "../lib/assistant";
import { currentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import { assistantRateLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

const MAX_MESSAGE_LENGTH = 4000;
// Assistant replies can legitimately be long — MAX_TOKENS (lib/assistant.ts) is
// 4096, i.e. up to ~12–16k characters for a multi-row analytics answer. Capping
// history entries at MAX_MESSAGE_LENGTH (4000) rejected the NEXT turn with a 400
// once such an answer was in history, bricking the chat until "New chat". The
// live user `message` stays capped at MAX_MESSAGE_LENGTH; only the (assistant)
// history content gets the larger ceiling.
const MAX_HISTORY_CONTENT_LENGTH = 24000;
const MAX_HISTORY_TURNS = 20;
// The Anthropic SDK's per-call `timeout` (lib/assistant.ts) only bounds
// connect/time-to-first-byte for each request in the tool loop — it does not
// bound a stream that starts flowing and then stalls. This wall-clock cap
// bounds the whole request regardless, alongside the existing
// client-disconnect abort below.
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const AssistantRequestBody = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_HISTORY_CONTENT_LENGTH),
      }),
    )
    .max(MAX_HISTORY_TURNS)
    .optional(),
});

const HISTORY_MALFORMED_MESSAGE = "Chat history is malformed. Please refresh and try again.";

/**
 * The Anthropic Messages API requires strict role alternation starting with
 * "user" and ending with "assistant" (a live user message is always
 * appended after this history), and 400s otherwise. The Zod schema above
 * only constrains each entry's role to "user" | "assistant" — it doesn't
 * check alternation or that the history ends on "assistant" — so a
 * malformed history (e.g. a client bug that drops/duplicates a turn, or one
 * ending on a dangling unanswered "user" turn) would previously reach the
 * Claude API and surface as a generic 502 instead of the client-side data
 * bug it actually is. Catch it cheaply here, before any Claude API call is
 * made.
 */
function findHistoryAlternationError(history: AssistantMessage[] | undefined): string | undefined {
  if (!history || history.length === 0) return undefined;
  let expected: AssistantMessage["role"] = "user";
  for (const turn of history) {
    if (turn.role !== expected) {
      return HISTORY_MALFORMED_MESSAGE;
    }
    expected = expected === "user" ? "assistant" : "user";
  }
  if (expected !== "user") {
    // Loop ended still expecting "user" next means the last entry was
    // "assistant" (well-formed). Otherwise the history ends on a dangling
    // "user" turn — appending the live message would produce two
    // consecutive user turns.
    return HISTORY_MALFORMED_MESSAGE;
  }
  return undefined;
}

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post("/assistant", assistantRateLimiter, async (req, res): Promise<void> => {
  const parsed = AssistantRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const history = parsed.data.history as AssistantMessage[] | undefined;
  const historyError = findHistoryAlternationError(history);
  if (historyError) {
    res.status(400).json({ error: historyError });
    return;
  }

  const user = currentUser(res);

  // Cancel the in-flight Claude API call if the client disconnects (tab
  // closed, navigated away) instead of letting it run to completion
  // server-side. `timedOut` distinguishes the two abort causes below, since
  // the signal itself doesn't carry a reason.
  //
  // On the RESPONSE, not the request. The request's 'close' fires as soon as
  // express.json has consumed the body, which is before the (async) rate
  // limiter lets this handler run, so a listener on `req` was attached too
  // late and never fired. The response's 'close' fires on disconnect, and
  // `writableFinished` tells a normal end apart from a torn-down socket.
  let timedOut = false;
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abortController.abort();
  });
  const overallTimeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, OVERALL_TIMEOUT_MS);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  // Writing to a socket the client already tore down would otherwise raise
  // an unhandled 'error' event; swallow it, res.on('close') above already
  // covers the abort.
  res.on("error", (err) => {
    logger.warn({ err }, "Assistant SSE response error");
  });

  try {
    const reply: AssistantReply = await runAssistant(
      parsed.data.message,
      history,
      { userId: user.id, userName: user.name },
      {
        onTextDelta: (text) => sendEvent(res, "text_delta", { text }),
        onToolCall: (toolName, input) => sendEvent(res, "tool_call", { toolName, input }),
        onToolResult: (trace) =>
          sendEvent(res, "tool_result", {
            toolName: trace.toolName,
            ok: trace.ok,
            data: trace.data,
            error: trace.error,
          }),
      },
      abortController.signal,
    );
    sendEvent(res, "done", reply);
  } catch (err) {
    if (abortController.signal.aborted && !timedOut) {
      // The client disconnected before completion — nothing to report, and
      // res.on('error') above already absorbs the dead-socket write that a
      // sendEvent here would trigger.
    } else if (timedOut) {
      sendEvent(res, "error", {
        message: "The assistant took too long to respond. Please try again.",
      });
    } else if (err instanceof Anthropic.APIError && err.status === 400) {
      // Defense-in-depth: findHistoryAlternationError above should prevent a
      // malformed history from ever reaching Claude, but if some other path
      // builds `messages` without going through that guard, surface the same
      // actionable message instead of the generic "temporarily unavailable."
      logger.warn({ err }, "Assistant received a 400 from the Claude API");
      sendEvent(res, "error", { message: HISTORY_MALFORMED_MESSAGE });
    } else {
      logger.error({ err }, "Assistant request failed");
      sendEvent(res, "error", { message: "The assistant is temporarily unavailable." });
    }
  } finally {
    clearTimeout(overallTimeout);
  }
  res.end();
});

export default router;
