"use client";

import { Suspense, useState, useRef, useEffect, useCallback, memo } from "react";
import { useSearchParams } from "next/navigation";
import { MarkdownHooks as ReactMarkdown } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { LazyMarkdown } from "@/components/LazyMarkdown";

const REMARK_PLUGINS = [remarkGfm];
const PROSE_CLASS =
  "prose prose-sm dark:prose-invert max-w-none [&_table]:block [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_pre]:overflow-x-auto";

// --- Timeline types + event parser -----------------------------------------

type ToolUseItem = {
  kind: "tool_use";
  id: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
};

type TextItem = {
  kind: "text";
  text: string;
  streaming: boolean;
};

type TimelineItem = ToolUseItem | TextItem;

type ParsedEvent = {
  type?: string;
  event?: {
    type?: string;
    content_block?: { type?: string };
    delta?: { type?: string; text?: string };
  };
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
};

function applyEvent(timeline: TimelineItem[], raw: ParsedEvent): TimelineItem[] {
  if (!raw || typeof raw !== "object") return timeline;

  if (raw.type === "stream_event" && raw.event) {
    const ev = raw.event;
    if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
      return [...timeline, { kind: "text", text: "", streaming: true }];
    }
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      const last = timeline[timeline.length - 1];
      const piece = ev.delta.text ?? "";
      if (last?.kind === "text" && last.streaming) {
        return [...timeline.slice(0, -1), { ...last, text: last.text + piece }];
      }
      return [...timeline, { kind: "text", text: piece, streaming: true }];
    }
    if (ev.type === "content_block_stop") {
      const last = timeline[timeline.length - 1];
      if (last?.kind === "text" && last.streaming) {
        return [...timeline.slice(0, -1), { ...last, streaming: false }];
      }
    }
    return timeline;
  }

  if (raw.type === "assistant" && raw.message?.content) {
    let next = timeline;
    for (const block of raw.message.content) {
      if (block?.type === "tool_use" && block.id && block.name) {
        next = [...next, { kind: "tool_use", id: block.id, name: block.name, input: block.input }];
      }
    }
    return next;
  }

  if (raw.type === "user" && raw.message?.content) {
    let next = timeline;
    for (const block of raw.message.content) {
      if (block?.type === "tool_result" && block.tool_use_id) {
        const id = block.tool_use_id;
        const result =
          typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        next = next.map((item) =>
          item.kind === "tool_use" && item.id === id
            ? { ...item, result, isError: !!block.is_error }
            : item
        );
      }
    }
    return next;
  }

  return timeline;
}

// --- Tool display helpers --------------------------------------------------

function toolSummary(item: ToolUseItem): string {
  const input = item.input as Record<string, unknown> | null;
  if (!input || typeof input !== "object") return "";
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (s(input.file_path)) return s(input.file_path);
  if (s(input.command)) return s(input.command);
  if (s(input.pattern)) return s(input.pattern);
  if (s(input.path)) return s(input.path);
  if (s(input.url)) return s(input.url);
  if (s(input.query)) return s(input.query);
  if (item.name === "Agent") return s(input.description) || s(input.prompt).slice(0, 80);
  if (s(input.prompt)) return s(input.prompt).slice(0, 80);
  return "";
}

function toolIcon(item: ToolUseItem): string {
  if (item.isError) return "✗";
  if (item.result == null) return "…";
  return "✓";
}

// --- Components -----------------------------------------------------------

const ToolRow = memo(function ToolRow({ item }: { item: ToolUseItem }) {
  const summary = toolSummary(item);
  const pending = item.result == null;
  return (
    <div className="flex gap-2 items-baseline text-xs font-mono">
      <span className={item.isError ? "text-red-400" : pending ? "text-muted-fg" : "text-green-500"}>
        {toolIcon(item)}
      </span>
      <span className="text-muted-fg">{item.name}</span>
      {summary && (
        <span className="text-muted-fg truncate opacity-70" title={summary}>{summary}</span>
      )}
    </div>
  );
});

const TextBlock = memo(function TextBlock({ item }: { item: TextItem }) {
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{item.text}</ReactMarkdown>
      {item.streaming && (
        <span className="inline-block w-1.5 h-4 bg-green-400 ml-0.5 align-text-bottom animate-pulse" />
      )}
    </div>
  );
});

function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) =>
        item.kind === "tool_use" ? <ToolRow key={i} item={item} /> : <TextBlock key={i} item={item} />
      )}
    </div>
  );
}

const Message = memo(function Message({
  role,
  text,
  showDivider,
}: {
  role: "user" | "assistant";
  text: string;
  showDivider: boolean;
}) {
  return (
    <div>
      <div className={`text-xs font-bold mb-1 ${role === "user" ? "text-blue-400" : "text-green-400"}`}>
        {role === "user" ? "You" : "Claude"}
      </div>
      <div className={PROSE_CLASS}>
        <LazyMarkdown>{text}</LazyMarkdown>
      </div>
      {showDivider && <hr className="border-border mt-4" />}
    </div>
  );
});

// --- Types ----------------------------------------------------------------

interface Session {
  sessionId: string;
  label: string;
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
  matchCount?: number;
  snippet?: string;
}

type SortMode = "recent" | "created";

interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

// --- Page -----------------------------------------------------------------

export default function ConsolePage() {
  return (
    <Suspense>
      <Console />
    </Suspense>
  );
}

function Console() {
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [sessionQuery, setSessionQuery] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoRanRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async (query = "") => {
    try {
      const url = query ? `/api/claude?q=${encodeURIComponent(query)}` : "/api/claude";
      const res = await fetch(url);
      if (res.ok) setSessions(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useRefetchOnFocus(() => loadSessions(sessionQuery.trim()));

  useEffect(() => {
    if (!showSessions) return;
    const q = sessionQuery.trim();
    const t = setTimeout(() => loadSessions(q), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [sessionQuery, showSessions, loadSessions]);

  useEffect(() => {
    if (autoRanRef.current) return;
    const sessionParam = searchParams.get("session");
    const cmd = searchParams.get("run");
    if (sessionParam) {
      autoRanRef.current = true;
      selectSession(sessionParam);
    } else if (cmd) {
      autoRanRef.current = true;
      run(cmd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = true) => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const distanceFromBottom = document.body.scrollHeight - window.scrollY - window.innerHeight;
    if (distanceFromBottom < 200) scrollToBottom(false);
  }, [timeline, history, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = Math.round(window.innerHeight * 0.4);
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [prompt]);

  useEffect(() => {
    function onScroll() {
      const distance = document.body.scrollHeight - window.scrollY - window.innerHeight;
      setShowJump(distance > 200);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const streamTail = useCallback(async (sessionId: string) => {
    abortRef.current = new AbortController();
    setRunning(true);
    setTimeline([]);
    let buffer = "";
    try {
      const res = await fetch(`/api/claude/tail?sessionId=${sessionId}`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        if (lines.length === 0) continue;
        setTimeline((prev) => {
          let next = prev;
          for (const line of lines) {
            if (!line.trim()) continue;
            try { next = applyEvent(next, JSON.parse(line) as ParsedEvent); } catch { /* skip */ }
          }
          return next;
        });
      }

      await loadHistory(sessionId);
      setTimeline([]);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setTimeline((prev) => [
          ...prev,
          { kind: "text", text: `\n\n*Error: ${e.message}*`, streaming: false },
        ]);
      }
    } finally {
      setRunning(false);
      loadSessions(sessionQuery.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery]);

  const loadHistory = useCallback(async (sessionId: string) => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/claude/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.messages || []);
        return { running: !!data.running };
      }
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
    return { running: false };
  }, []);

  async function selectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setTimeline([]);
    setShowSessions(false);
    window.history.replaceState(null, "", `/?session=${sessionId}`);
    const { running: isRunning } = await loadHistory(sessionId);
    if (isRunning) streamTail(sessionId);
  }

  async function run(text: string, sessionId?: string | null) {
    if (!text.trim() || running) return;
    setTimeline([]);
    setHistory((prev) => [...prev, { role: "user", text: text.trim() }]);
    setPrompt("");

    try {
      const body: Record<string, string | boolean> = { prompt: text.trim() };
      if (sessionId) body.sessionId = sessionId;
      if (skipPermissions) body.skipPermissions = true;

      const startRes = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        setTimeline([{ kind: "text", text: `Error: ${err.error || startRes.statusText}`, streaming: false }]);
        return;
      }

      const { sessionId: startedSessionId } = await startRes.json();
      if (startedSessionId) {
        setActiveSessionId(startedSessionId);
        window.history.replaceState(null, "", `/?session=${startedSessionId}`);
        await streamTail(startedSessionId);
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        setTimeline((prev) => [
          ...prev,
          { kind: "text", text: `\n\n*Error: ${e.message}*`, streaming: false },
        ]);
      }
    }
  }

  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    abortRef.current?.abort();
    setRunning(false);
    setTimeline([]);
    try {
      const [historyResult] = await Promise.all([
        activeSessionId ? loadHistory(activeSessionId) : Promise.resolve({ running: false }),
        loadSessions(sessionQuery.trim()),
      ]);
      if (activeSessionId && historyResult?.running) streamTail(activeSessionId);
    } finally {
      setRefreshing(false);
    }
  }

  function formatDate(ms: number) {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const liveActive = running || timeline.length > 0;

  return (
    <main className="max-w-5xl mx-auto p-3 sm:p-8">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Console</h1>
        <div className="flex gap-2 sm:gap-3 items-center">
          <button
            onClick={() => {
              setActiveSessionId(null);
              setTimeline([]);
              setHistory([]);
              setShowSessions(false);
              window.history.replaceState(null, "", "/");
            }}
            className="text-sm text-blue-500 hover:text-blue-400"
          >
            New Session
          </button>
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="text-sm text-muted hover:text-foreground"
          >
            {showSessions ? "Hide" : "Sessions"} ({sessions.length})
          </button>
        </div>
      </div>

      {showSessions && (
        <div className="mb-6">
          <div className="flex flex-wrap gap-2 mb-2 items-center">
            <button
              onClick={() => setSortMode("recent")}
              className={`text-xs px-2 py-1 rounded ${
                sortMode === "recent" ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Recent activity
            </button>
            <button
              onClick={() => setSortMode("created")}
              className={`text-xs px-2 py-1 rounded ${
                sortMode === "created" ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              Created
            </button>
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="Search sessions…"
              className="flex-1 min-w-[10rem] ml-auto px-2 py-1 bg-surface border border-border rounded text-base sm:text-xs placeholder-muted"
            />
          </div>
          <div className="border border-border rounded max-h-96 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="p-3 text-sm text-muted">
                {sessionQuery.trim() ? `No matches for "${sessionQuery.trim()}"` : "No sessions yet"}
              </p>
            ) : (
              [...sessions]
                .sort((a, b) =>
                  sortMode === "recent" ? b.lastActiveAt - a.lastActiveAt : b.startedAt - a.startedAt
                )
                .map((s) => (
                  <button
                    key={s.sessionId}
                    onClick={() => selectSession(s.sessionId)}
                    className={`w-full text-left p-3 border-b border-border last:border-b-0 hover:bg-surface transition ${
                      activeSessionId === s.sessionId ? "bg-surface" : ""
                    }`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <span className="text-sm truncate flex-1 min-w-0">{s.label}</span>
                      <span className="text-xs text-muted whitespace-nowrap">
                        {formatDate(sortMode === "recent" ? s.lastActiveAt : s.startedAt)}{" "}
                        · {s.messageCount} msgs
                        {s.matchCount ? ` · ${s.matchCount} match${s.matchCount === 1 ? "" : "es"}` : ""}
                      </span>
                    </div>
                    {s.snippet && (
                      <div className="text-xs text-muted-fg mt-1 line-clamp-2">{s.snippet}</div>
                    )}
                  </button>
                ))
            )}
          </div>
        </div>
      )}

      {activeSessionId && (
        <div className="mb-4 px-3 py-2 bg-surface border border-border rounded text-sm flex items-center justify-between">
          <span className="text-muted">
            Resuming:{" "}
            <span className="text-foreground">
              {sessions.find((s) => s.sessionId === activeSessionId)?.label ||
                activeSessionId.slice(0, 8)}
            </span>
          </span>
          <button
            onClick={() => { setActiveSessionId(null); setHistory([]); setTimeline([]); }}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="space-y-4 mb-6">
        {loadingHistory ? (
          <span className="text-muted-fg text-sm">Loading history...</span>
        ) : history.length === 0 && !liveActive ? (
          <span className="text-muted-fg text-sm">Output will appear here</span>
        ) : (
          <>
            {history.map((msg, i) => (
              <Message key={i} role={msg.role} text={msg.text} showDivider={i < history.length - 1} />
            ))}

            {liveActive && (
              <div>
                {history.length > 0 && <hr className="border-border mb-4" />}
                <div className="text-xs font-bold mb-1 text-green-400 flex items-center gap-2">
                  <span>Claude</span>
                  {running && <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />}
                </div>
                {timeline.length === 0 && running ? (
                  <div className="text-muted-fg text-xs font-mono">Starting…</div>
                ) : (
                  <Timeline items={timeline} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !running && prompt.trim()) {
            e.preventDefault();
            run(prompt, activeSessionId);
          }
        }}
        placeholder={activeSessionId ? "Continue the conversation..." : "Enter a prompt or /slash-command..."}
        rows={3}
        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-base sm:text-sm placeholder-muted resize-y overflow-auto mb-2 min-h-[5rem]"
      />
      <div className="flex items-center justify-between">
        <button
          onClick={() => setSkipPermissions(!skipPermissions)}
          className={`text-xs px-2 py-1 rounded transition ${
            skipPermissions
              ? "bg-amber-600/20 text-amber-500 border border-amber-600/40"
              : "text-muted hover:text-foreground"
          }`}
        >
          {skipPermissions ? "Skip permissions: ON" : "Auto permissions"}
        </button>
        <button
          onClick={() => run(prompt, activeSessionId)}
          disabled={!prompt.trim() || running}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
        >
          {running ? "Running…" : "Send"}
        </button>
      </div>

      <button
        onClick={refresh}
        disabled={refreshing}
        aria-label="Refresh session"
        className="fixed bottom-20 right-6 z-40 h-10 w-10 rounded-full bg-surface border border-border shadow-lg text-muted hover:text-foreground hover:bg-surface-hover transition flex items-center justify-center disabled:opacity-50"
      >
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={refreshing ? "animate-spin" : ""}
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>

      {showJump && (
        <button
          onClick={() => scrollToBottom()}
          aria-label="Jump to bottom"
          className="fixed bottom-6 right-6 z-40 h-10 w-10 rounded-full bg-surface border border-border shadow-lg text-muted hover:text-foreground hover:bg-surface-hover transition flex items-center justify-center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </main>
  );
}
