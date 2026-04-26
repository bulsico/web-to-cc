import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { mkdirSync, openSync, closeSync } from "fs";
import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import path from "path";
import { config } from "@/lib/config";
import {
  isRunning,
  isValidSessionId,
  logPathFor,
  stderrPathFor,
  readState,
  writeState,
} from "@/lib/claude-sessions";

export async function POST(req: NextRequest) {
  const { prompt, sessionId, skipPermissions } = await req.json();

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  if (sessionId !== undefined && !isValidSessionId(sessionId)) {
    return Response.json({ error: "invalid sessionId" }, { status: 400 });
  }

  const effectiveSessionId = sessionId || randomUUID();

  if (isRunning(effectiveSessionId)) {
    return Response.json(
      { error: "session already running", sessionId: effectiveSessionId },
      { status: 409 }
    );
  }

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "auto");
  }

  if (sessionId) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", effectiveSessionId);
  }
  args.push(prompt);

  mkdirSync(config.logDir, { recursive: true });
  const logPath = logPathFor(effectiveSessionId);
  const stderrPath = stderrPathFor(effectiveSessionId);
  const logFd = openSync(logPath, "w");
  const errFd = openSync(stderrPath, "w");

  const claude = spawn(config.claudeBinary, args, {
    cwd: config.projectDir,
    env: { ...process.env },
    stdio: ["ignore", logFd, errFd],
    detached: true,
  });

  closeSync(logFd);
  closeSync(errFd);
  claude.unref();

  const pid = claude.pid!;
  const startedAt = Date.now();
  writeState(effectiveSessionId, { pid, startedAt });

  claude.on("close", (code) => {
    const current = readState(effectiveSessionId) || { pid, startedAt };
    writeState(effectiveSessionId, {
      ...current,
      finishedAt: Date.now(),
      exitCode: code ?? undefined,
    });
  });

  claude.on("error", (e) => {
    const current = readState(effectiveSessionId) || { pid, startedAt };
    writeState(effectiveSessionId, {
      ...current,
      finishedAt: Date.now(),
      error: e.message,
    });
  });

  return Response.json({ sessionId: effectiveSessionId, pid });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c?.type === "text" && typeof c.text === "string") return c.text;
        if (c?.type === "tool_use" && typeof c.input === "object") {
          try { return JSON.stringify(c.input); } catch { return ""; }
        }
        if (c?.type === "tool_result") {
          if (typeof c.content === "string") return c.content;
          if (Array.isArray(c.content)) return extractText(c.content);
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function makeSnippet(haystack: string, needle: string, radius = 60): string {
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + needle.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < haystack.length ? "…" : "";
  return (prefix + haystack.slice(start, end) + suffix).replace(/\s+/g, " ").trim();
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const needle = q.toLowerCase();

  try {
    const files = await readdir(config.sessionsDir);
    const jsonlFiles = files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""));

    const sessions = await Promise.all(
      jsonlFiles.map(async (sessionId) => {
        const filePath = path.join(config.sessionsDir, `${sessionId}.jsonl`);
        try {
          const rl = createInterface({
            input: createReadStream(filePath),
            crlfDelay: Infinity,
          });

          let firstUserMessage = "";
          let startedAt = 0;
          let lastActiveAt = 0;
          let messageCount = 0;
          let matchCount = 0;
          let snippet = "";

          for await (const line of rl) {
            try {
              const msg = JSON.parse(line);

              if (msg.timestamp) {
                const ts =
                  typeof msg.timestamp === "number"
                    ? msg.timestamp
                    : new Date(msg.timestamp).getTime();
                if (ts && !isNaN(ts)) {
                  if (!startedAt) startedAt = ts;
                  lastActiveAt = ts;
                }
              }

              if (msg.type === "user" || msg.type === "assistant") {
                messageCount++;
                const text = extractText(msg.message?.content);

                if (msg.type === "user" && !firstUserMessage) {
                  firstUserMessage = text
                    .slice(0, 200)
                    .replace(/<command-[^>]*>[^<]*<\/command-[^>]*>/g, "")
                    .replace(/<[^>]+>/g, "")
                    .trim()
                    .slice(0, 120);
                }

                if (needle && text) {
                  const hay = text.toLowerCase();
                  let from = 0;
                  while (true) {
                    const found = hay.indexOf(needle, from);
                    if (found < 0) break;
                    matchCount++;
                    if (!snippet) snippet = makeSnippet(text, q);
                    from = found + needle.length;
                  }
                }
              }
            } catch {
              // skip malformed lines
            }
          }

          if (!startedAt || !lastActiveAt) {
            try {
              const fileStat = await stat(filePath);
              if (!startedAt) startedAt = fileStat.mtimeMs;
              if (!lastActiveAt) lastActiveAt = fileStat.mtimeMs;
            } catch {
              // ignore
            }
          }

          return {
            sessionId,
            label: firstUserMessage || "(no messages)",
            startedAt,
            lastActiveAt,
            messageCount,
            matchCount,
            snippet,
            running: isRunning(sessionId),
          };
        } catch {
          return null;
        }
      })
    );

    let validSessions = sessions.filter(
      (s): s is NonNullable<typeof s> => s !== null
    );

    if (needle) {
      validSessions = validSessions.filter(
        (s) =>
          s.matchCount > 0 ||
          s.label.toLowerCase().includes(needle) ||
          s.sessionId.toLowerCase().includes(needle)
      );
    }

    validSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    return Response.json(validSessions);
  } catch {
    return Response.json([]);
  }
}
