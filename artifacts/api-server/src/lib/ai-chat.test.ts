import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenAiStreamAccumulator,
  toAnthropicMessages,
  toOpenAiMessages,
  type ChatMessage,
} from "./ai-chat";

const conversation: ChatMessage[] = [
  { role: "user", text: "How many deals?" },
  { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "deal_stats", input: { status: "open" } }] },
  { role: "tool", results: [{ id: "c1", content: '{"count":3}' }, { id: "c2", content: "boom", isError: true }] },
  { role: "assistant", text: "Three.", cacheMark: true },
];

test("Anthropic messages: tool calls, tool results and cache marks", () => {
  const out = toAnthropicMessages(conversation);
  assert.deepEqual(out[0], { role: "user", content: "How many deals?" });
  // A tool-only assistant turn has no empty text block (the API rejects one).
  assert.deepEqual(out[1], {
    role: "assistant",
    content: [{ type: "tool_use", id: "c1", name: "deal_stats", input: { status: "open" } }],
  });
  assert.deepEqual(out[2], {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "c1", content: '{"count":3}' },
      { type: "tool_result", tool_use_id: "c2", content: "boom", is_error: true },
    ],
  });
  assert.deepEqual(out[3], {
    role: "assistant",
    content: [{ type: "text", text: "Three.", cache_control: { type: "ephemeral" } }],
  });
});

test("OpenAI messages: system prompts first, one tool message per result", () => {
  const out = toOpenAiMessages({ stableSystem: "S", dynamicSystem: "D", messages: conversation });
  assert.deepEqual(out.map((m) => m.role), ["system", "system", "user", "assistant", "tool", "tool", "assistant"]);
  assert.deepEqual(out[3], {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "c1", type: "function", function: { name: "deal_stats", arguments: '{"status":"open"}' } }],
  });
  assert.deepEqual(out[5], { role: "tool", tool_call_id: "c2", content: "Error: boom" });
  assert.deepEqual(out[6], { role: "assistant", content: "Three." });
});

const chunk = (delta: object, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] });

test("OpenAI stream: text deltas are streamed and joined", () => {
  const seen: string[] = [];
  const acc = new OpenAiStreamAccumulator((t) => seen.push(t));
  acc.push(chunk({ content: "Hel" }));
  acc.push(chunk({ content: "lo" }));
  acc.push(chunk({}, "stop"));
  assert.deepEqual(seen, ["Hel", "lo"]);
  assert.deepEqual(acc.result(), { text: "Hello", toolCalls: [], stop: "end", rawStop: "stop" });
});

test("OpenAI stream: tool calls are assembled from fragments, in index order", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.push(chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "search_crm", arguments: '{"q":' } }] }));
  acc.push(chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "get_deal", arguments: "" } }] }));
  acc.push(chunk({ tool_calls: [{ index: 0, function: { arguments: '"Acme"}' } }] }));
  acc.push(chunk({ tool_calls: [{ index: 1, function: { arguments: '{"id":7}' } }] }));
  acc.push(chunk({}, "tool_calls"));
  const r = acc.result();
  assert.equal(r.stop, "tool_use");
  assert.deepEqual(r.toolCalls, [
    { id: "a", name: "search_crm", input: { q: "Acme" } },
    { id: "b", name: "get_deal", input: { id: 7 } },
  ]);
});

test("OpenAI stream: length is truncation, a refusal or content filter is a refusal", () => {
  const cut = new OpenAiStreamAccumulator();
  cut.push(chunk({ content: "partial" }, "length"));
  assert.equal(cut.result().stop, "truncated");

  const refused = new OpenAiStreamAccumulator();
  refused.push(chunk({ refusal: "I can't help with that." }, "stop"));
  assert.equal(refused.result().stop, "refusal");

  const filtered = new OpenAiStreamAccumulator();
  filtered.push(chunk({}, "content_filter"));
  assert.equal(filtered.result().stop, "refusal");
});

test("OpenAI stream: malformed arguments reach the tool instead of throwing", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.push(chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "get_deal", arguments: '{"id":' } }] }, "tool_calls"));
  assert.deepEqual(acc.result().toolCalls[0].input, { _unparsedArguments: '{"id":' });
});
