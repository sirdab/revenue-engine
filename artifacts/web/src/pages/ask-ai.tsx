import { memo, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, ArrowUpRight, Database, Plus, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  streamAssistantMessage,
  MAX_HISTORY_TURNS,
  type AssistantMessage,
  type AssistantToolTrace,
} from "@/lib/assistant-api";
import { useI18n, tStatic } from "@/lib/i18n/i18n";
import { formatNumber } from "@/lib/format";

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return tStatic(value ? "common.yes" : "common.no");
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  traces?: AssistantToolTrace[];
}

interface SearchTraceData {
  items?: Array<{
    recordType?: string;
    recordId?: number;
    title?: string;
    matchedField?: string;
    snippet?: string;
    relatedName?: string | null;
    href?: string;
    scoreBand?: string;
  }>;
  total?: number;
  truncated?: boolean;
}

interface RecordContextData {
  recordType?: string;
  recordId?: number;
  title?: string;
  summary?: Record<string, unknown>;
  relatedDeals?: Array<Record<string, unknown>>;
  recentNotes?: Array<Record<string, unknown>>;
  recentActivities?: Array<Record<string, unknown>>;
}

const STORAGE_KEY = "ask-ai-messages";
const MAX_TEXTAREA_HEIGHT = 160;

let messageSeq = 0;
function nextId(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

/**
 * Advance the id counter past any ids restored from a persisted session.
 * `messageSeq` is module state that resets to 0 on every page load, but
 * restored messages keep their original `m1`, `m2`, … ids — without this,
 * `nextId()` would re-issue ids that collide with restored ones, which both
 * duplicates React keys and (because streaming updates match by id) corrupts
 * an earlier message when a colliding new assistant reply streams in.
 */
function reseedMessageSeq(restored: ChatMessage[]): void {
  for (const message of restored) {
    const match = /^m(\d+)$/.exec(message.id);
    if (match) messageSeq = Math.max(messageSeq, Number(match[1]));
  }
}

/** Only allow in-app relative paths or http(s) links from record data — never a `javascript:`/`data:` scheme. */
function safeHref(href: string | null | undefined): string {
  if (!href) return "#";
  if (href.startsWith("/")) return href;
  try {
    const scheme = new URL(href, window.location.origin).protocol;
    if (scheme === "http:" || scheme === "https:") return href;
  } catch {
    // Unparseable — fall through to the inert default.
  }
  return "#";
}

/**
 * Builds the history array sent to the server from only complete, successful
 * (user, assistant) turn pairs. An assistant message with `error: true` means
 * its reply never landed, so its preceding user turn is dropped along with
 * it — otherwise that orphaned user turn would break strict user/assistant
 * alternation once the caller appends the new live user turn after it (the
 * server's history-alternation check, and the Anthropic API itself, both
 * reject that).
 */
function buildHistoryPairs(messages: ChatMessage[]): AssistantMessage[] {
  const pairs: AssistantMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const next = messages[i + 1];
    if (!next || next.role !== "assistant" || next.error) continue;
    pairs.push({ role: "user", content: message.content });
    pairs.push({ role: "assistant", content: next.content });
  }
  // Pairs are always pushed two-at-a-time ([user, assistant]), so slicing the
  // last MAX_HISTORY_TURNS entries can only cut between pairs, never mid-pair
  // — alternation survives the cut.
  return pairs.slice(-MAX_HISTORY_TURNS);
}

function renderInline(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={`${keyPrefix}-${i++}`} className="font-semibold">
          {match[1]}
        </strong>,
      );
    } else if (match[2] !== undefined) {
      parts.push(
        <code
          key={`${keyPrefix}-${i++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {match[2]}
        </code>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const TABLE_SEPARATOR_CELL = /^:?-+:?$/;

/** Splits a `| a | b |` row into trimmed cells, dropping the outer empty cells from the leading/trailing pipe. */
function splitTableRow(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  if (!line.includes("|") && !line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

function renderTable(header: string[], rows: string[][], key: number) {
  return (
    <div key={`table-${key}`} className="my-1.5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max border-collapse text-start text-body">
        <thead>
          <tr className="bg-muted/50">
            {header.map((cell, idx) => (
              <th
                key={idx}
                className="border-b border-border px-2.5 py-1.5 font-semibold text-foreground"
              >
                {renderInline(cell, `th-${key}-${idx}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border last:border-0">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className="px-2.5 py-1.5 align-top text-muted-foreground">
                  {renderInline(cell, `td-${key}-${rowIdx}-${cellIdx}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderContent(content: string) {
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    const items = listBuffer;
    blocks.push(
      <ul key={`list-${key++}`} className="my-1 ms-4 list-disc space-y-0.5">
        {items.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${key}-${idx}`)}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // A GFM table is a header row immediately followed by a separator row
    // (e.g. `|---|:---:|`) — check one line ahead before committing to it.
    if (line.startsWith("|") && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      flushList();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      blocks.push(renderTable(header, rows, key++));
      i = j - 1;
      continue;
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      continue;
    }
    flushList();
    if (line.length > 0) {
      blocks.push(
        <p key={`p-${key++}`} className="[&:not(:first-child)]:mt-1.5">
          {renderInline(line, `p-${key}`)}
        </p>,
      );
    }
  }
  flushList();
  return blocks;
}

function toolLabel(toolName: string): string {
  switch (toolName) {
    case "search_crm":
      return tStatic("askAi.tool.searchCrm");
    case "get_record_context":
      return tStatic("askAi.tool.recordContext");
    case "pipeline_summary":
      return tStatic("askAi.tool.pipelineSummary");
    case "list_deals":
      return tStatic("askAi.tool.dealList");
    case "get_deal":
      return tStatic("askAi.tool.dealDetail");
    default:
      return toolName;
  }
}

function getLatestTrace<T>(
  traces: AssistantToolTrace[] | undefined,
  toolName: string,
): T | null {
  if (!traces?.length) return null;
  for (let i = traces.length - 1; i >= 0; i -= 1) {
    const trace = traces[i];
    if (trace.toolName === toolName && trace.ok) return (trace.data as T) ?? null;
  }
  return null;
}

function getAllTraces<T>(
  traces: AssistantToolTrace[] | undefined,
  toolName: string,
): T[] {
  return (traces ?? [])
    .filter((trace) => trace.toolName === toolName && trace.ok)
    .map((trace) => trace.data as T);
}

/** "Good morning" / "Good afternoon" / "Good evening", by local wall-clock hour — used by the empty-state greeting in `EmptyState`. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return tStatic("home.goodMorning");
  if (hour < 18) return tStatic("home.goodAfternoon");
  return tStatic("home.goodEvening");
}

function AssistantEyebrow() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 text-caption font-semibold tracking-[0.02em] text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5" /> {t("askAi.title")}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  selected,
  onSelect,
}: {
  message: ChatMessage;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const isUser = message.role === "user";
  const reduceMotion = useReducedMotion();
  const { tPlural } = useI18n();

  if (isUser) {
    return (
      <div className="flex justify-end">
        <motion.div
          layout={!reduceMotion}
          initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="max-w-[80%] whitespace-pre-wrap rounded-[16px_16px_4px_16px] bg-muted px-4 py-3 text-[15px] leading-relaxed text-foreground"
        >
          {message.content}
        </motion.div>
      </div>
    );
  }

  const okCount = message.traces?.filter((tr) => tr.ok).length ?? 0;

  return (
    <motion.button
      type="button"
      layout={!reduceMotion}
      initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      onClick={() => onSelect?.(message.id)}
      className={cn(
        "flex w-full flex-col gap-3.5 text-start",
        okCount > 0 ? "cursor-pointer" : "cursor-default",
      )}
    >
      <AssistantEyebrow />
      <div
        className={cn(
          "w-full text-[15px] leading-[1.65]",
          message.error ? "text-destructive" : "text-foreground/90",
        )}
      >
        {renderContent(message.content)}
      </div>
      {okCount > 0 ? (
        <div
          className={cn(
            "flex items-center gap-1.5 text-caption",
            selected ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Database className="h-3.5 w-3.5" />
          {tPlural("askAi.liveSources", okCount)}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </div>
      ) : null}
    </motion.button>
  );
});

function ThinkingBubble({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-3.5"
    >
      <AssistantEyebrow />
      <span className="relative overflow-hidden text-[15px] text-muted-foreground">
        {label}
        {!reduceMotion && (
          <motion.span
            className="absolute inset-y-0 start-0 w-8 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
            animate={{ x: ["-2rem", "10rem"] }}
            transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </span>
    </motion.div>
  );
}

/**
 * Centered greeting + composer shown before the first message
 * (design direction 2a "Grounded greeting").
 */
function EmptyState({
  firstName,
  input,
  isStreaming,
  textareaRef,
  onChangeInput,
  onKeyDown,
  onSend,
}: {
  firstName: string;
  input: string;
  isStreaming: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChangeInput: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (text?: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-[548px]">
        <div className="text-center">
          <h1 className="font-heading text-[29px] font-semibold tracking-tight text-foreground">
            {greeting()}, {firstName}.
          </h1>
          <p className="mt-1.5 text-[19px] text-muted-foreground">{t("askAi.prompt")}</p>
        </div>
        <div className="mt-6">
          <Composer
            placeholder={t("askAi.placeholder")}
            rows={2}
            input={input}
            isStreaming={isStreaming}
            textareaRef={textareaRef}
            onChangeInput={onChangeInput}
            onKeyDown={onKeyDown}
            onSend={onSend}
          />
        </div>
        <div className="mt-4 text-center text-[12px] text-muted-foreground">
          {t("askAi.betaNote")}
        </div>
      </div>
    </div>
  );
}

const RAIL_CARD =
  "block rounded-xl border border-border bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_12px_24px_-14px_rgba(18,51,80,0.3)]";

/** Titled group of stacked rail cards — uppercase eyebrow + a `gap`-spaced stack. */
function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

/** Tiny uppercase "kind" label on a rail card (record type, e.g. "Deal", "Contact"). */
function RailCardEyebrow({ label }: { label: string }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * Tool-adaptive context rail — reads only the SELECTED assistant message's
 * existing tool traces (no new fetches). Sections render in priority order
 * and only when their backing trace data is present.
 */
function ContextRail({ message }: { message: ChatMessage | null }) {
  const { t } = useI18n();
  const traces = message?.traces;
  const okCount = traces?.filter((tr) => tr.ok).length ?? 0;
  const search = getLatestTrace<SearchTraceData>(traces, "search_crm");
  const contexts = getAllTraces<RecordContextData>(traces, "get_record_context");
  const pipeline = getLatestTrace<Record<string, unknown>>(traces, "pipeline_summary");
  const dealStats = getLatestTrace<{ groups?: Array<Record<string, unknown>> }>(traces, "deal_stats");

  if (!message || message.role !== "assistant" || okCount === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-body-quiet text-muted-foreground">
        {t("askAi.railEmpty")}
      </div>
    );
  }

  const matches = search?.items?.slice(0, 6) ?? [];
  const relatedDeals = contexts.flatMap((context) => context.relatedDeals ?? []).slice(0, 6);
  const dealStatRows = dealStats?.groups?.slice(0, 3) ?? [];
  const hasSignals = Boolean(pipeline) || dealStatRows.length > 0;

  const description =
    matches.length > 0
      ? t("askAi.desc.matches")
      : relatedDeals.length > 0
        ? t("askAi.desc.deals")
        : t("askAi.desc.records");

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-4 py-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("askAi.behindAnswer")}
          </span>
          <span className="text-caption-quiet text-muted-foreground">
            {okCount} source{okCount === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">{description}</p>
      </div>

      {matches.length > 0 && (
        <RailSection title={t("askAi.matches")}>
          {matches.map((item, idx) => (
            <a key={`${item.recordType ?? "record"}-${item.recordId ?? idx}`} href={safeHref(item.href)} className={RAIL_CARD}>
              <div className="mb-1.5 flex items-center justify-between">
                <RailCardEyebrow label={item.recordType ?? t("askAi.record")} />
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="text-body font-medium text-foreground">{item.title ?? "—"}</div>
              {item.snippet ? (
                <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{item.snippet}</p>
              ) : null}
              <Badge variant="outline" className="mt-2">
                {item.scoreBand ?? "low"}
              </Badge>
            </a>
          ))}
        </RailSection>
      )}

      {relatedDeals.length > 0 && (
        <RailSection title={t("askAi.relatedDeals")}>
          {relatedDeals.map((deal, idx) => (
            <a key={`${String(deal.id)}-${idx}`} href={`/deal/${String(deal.id)}`} className={RAIL_CARD}>
              <div className="text-body font-medium text-foreground">{formatValue(deal.title)}</div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {formatValue(deal.value)} · {formatValue(deal.stage)} · {formatValue(deal.owner)}
              </div>
            </a>
          ))}
        </RailSection>
      )}

      {hasSignals && (
        <RailSection title={t("askAi.signals")}>
          {pipeline && (
            <div className={RAIL_CARD}>
              <div className="text-body font-medium text-foreground">{formatValue(pipeline.pipelineName)}</div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {t("askAi.pipelineLine", { count: formatValue(pipeline.totalCount), value: formatValue(pipeline.totalValue) })}
              </div>
            </div>
          )}
          {dealStatRows.map((row, idx) => (
            <div
              key={`deal-stat-${String(row.key ?? row.label ?? idx)}-${String(row.currency)}`}
              className={RAIL_CARD}
            >
              <div className="text-body font-medium text-foreground">{formatValue(row.label)}</div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {formatValue(row.count)} · {formatValue(row.value)} {formatValue(row.currency)}
              </div>
            </div>
          ))}
        </RailSection>
      )}
    </div>
  );
}

/**
 * Shared rounded input card used by both the empty state (Task 3) and the
 * active chat column (Task 4). Autosize is handled by the parent's
 * `resizeTextarea` via the forwarded `textareaRef` — this component owns no
 * sizing logic of its own. The scope pill is a non-functional visual stub
 * this pass (no dropdown behavior).
 */
function Composer({
  input,
  placeholder,
  rows,
  isStreaming,
  textareaRef,
  onChangeInput,
  onKeyDown,
  onSend,
}: {
  input: string;
  placeholder: string;
  rows: number;
  isStreaming: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChangeInput: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (text?: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 pb-2.5 shadow-[0_10px_30px_-20px_rgba(18,51,80,0.35)]">
      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => onChangeInput(e.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="min-h-0 resize-none border-0 bg-transparent px-1 py-0.5 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-end">
        <Button
          size="icon"
          className="h-9 w-9 rounded-full"
          disabled={!input.trim() || isStreaming}
          onClick={() => onSend()}
          aria-label={t("common.send")}
        >
          <ArrowUp className="h-[18px] w-[18px]" />
        </Button>
      </div>
    </div>
  );
}

export default function AskAIPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "there";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (!Array.isArray(parsed)) return;
      reseedMessageSeq(parsed);
      setMessages(parsed);
      const lastAssistant = [...parsed].reverse().find((message) => message.role === "assistant");
      if (lastAssistant) setSelectedMessageId(lastAssistant.id);
    } catch {
      // Ignore a bad session snapshot and start fresh.
    }
  }, []);

  // Skip writing while a stream is in flight so a page reload mid-answer
  // never resurrects a half-typed assistant message — only the last
  // committed (fully streamed, errored, or user) message content persists.
  useEffect(() => {
    if (isStreaming) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages, isStreaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  // Abort any still-in-flight stream if the page unmounts (nav away).
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  function resizeTextarea(): void {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  // Recovery affordance: lets a user escape a stuck/malformed conversation
  // (e.g. a broken history state) without having to close the tab. Aborts
  // any in-flight stream directly (rather than going through handleSend's
  // own abort handling) so isStreaming is reliably cleared even mid-stream.
  // Clearing `messages` here is enough to persist an empty conversation —
  // the sessionStorage-persistence effect below picks up the change.
  function handleNewChat(): void {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    setSelectedMessageId(null);
  }

  async function handleSend(text?: string): Promise<void> {
    const content = (text ?? input).trim();
    if (!content || isStreaming) return;

    const history: AssistantMessage[] = buildHistoryPairs(messages);

    setMessages((prev) => [...prev, { id: nextId(), role: "user", content }]);
    setInput("");
    requestAnimationFrame(resizeTextarea);

    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    const assistantId = nextId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    setSelectedMessageId(assistantId);
    setIsStreaming(true);
    setActiveToolLabel(null);

    try {
      const response = await streamAssistantMessage(
        content,
        history,
        {
          onTextDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            );
          },
          onToolCall: (toolName) => {
            setActiveToolLabel(toolLabel(toolName));
          },
          onToolResult: (trace) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, traces: [...(m.traces ?? []), trace] } : m,
              ),
            );
          },
        },
        abortController.signal,
      );

      // Source of truth once the stream completes, in case any deltas were
      // missed in transit.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: response.reply, traces: response.traces } : m,
        ),
      );
    } catch (err) {
      if (abortController.signal.aborted) {
        // Superseded by a newer send or the page unmounted — drop the
        // in-progress placeholder instead of showing a stale error.
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: err instanceof Error ? err.message : t("common.somethingWentWrongDot"),
                error: true,
              }
            : m,
        ),
      );
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
        setIsStreaming(false);
        setActiveToolLabel(null);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const selectedMessage =
    messages.find((message) => message.id === selectedMessageId) ??
    [...messages].reverse().find((message) => message.role === "assistant") ??
    null;

  // Only show the "thinking" placeholder in the gap before the first
  // text_delta lands for the send in flight — once content starts arriving,
  // the streaming placeholder message itself (via MessageBubble) takes over.
  const lastMessage = messages[messages.length - 1];
  const showThinking =
    isStreaming &&
    lastMessage?.role === "assistant" &&
    !lastMessage.error &&
    lastMessage.content.length === 0;

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {messages.length === 0 ? (
        <EmptyState
          firstName={firstName}
          input={input}
          isStreaming={isStreaming}
          textareaRef={textareaRef}
          onChangeInput={(v) => {
            setInput(v);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex justify-end px-6 pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={handleNewChat}
              >
                <Plus className="h-4 w-4" />
                {t("askAi.newChat")}
              </Button>
            </div>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 md:px-8">
              <div className="mx-auto flex max-w-[720px] flex-col gap-6">
                <AnimatePresence initial={false} mode="popLayout">
                  {messages.map((message, idx) => {
                    // While showThinking is true, the last message is the
                    // empty streaming placeholder — render ThinkingBubble in
                    // its place below instead of an empty bubble; the
                    // placeholder takes over as soon as content stops being
                    // empty.
                    if (showThinking && idx === messages.length - 1) return null;
                    return (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        selected={message.id === selectedMessageId}
                        onSelect={setSelectedMessageId}
                      />
                    );
                  })}
                  {showThinking ? (
                    <ThinkingBubble key="thinking" label={activeToolLabel ?? t("askAi.thinking")} />
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[720px] px-6 pb-6 md:px-8">
              <Composer
                placeholder={t("askAi.followUpPlaceholder")}
                rows={1}
                input={input}
                isStreaming={isStreaming}
                textareaRef={textareaRef}
                onChangeInput={(v) => {
                  setInput(v);
                  resizeTextarea();
                }}
                onKeyDown={handleKeyDown}
                onSend={handleSend}
              />
              <div className="mt-2.5 text-center text-[12px] text-muted-foreground">
                {t("askAi.betaNote")}
              </div>
            </div>
          </div>
          <aside className="hidden w-[328px] shrink-0 border-s border-border bg-muted/30 lg:block">
            <ContextRail message={selectedMessage} />
          </aside>
        </>
      )}
    </div>
  );
}
