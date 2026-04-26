import { createReadStream } from "fs";
import { createInterface } from "readline";
import { NextRequest } from "next/server";
import path from "path";
import { config } from "@/lib/config";
import { isRunning, isValidSessionId } from "@/lib/claude-sessions";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  if (!isValidSessionId(sessionId)) {
    return Response.json({ error: "invalid sessionId" }, { status: 400 });
  }
  const filePath = path.join(config.sessionsDir, `${sessionId}.jsonl`);

  try {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });

    const messages: Message[] = [];

    for await (const line of rl) {
      try {
        const msg = JSON.parse(line);

        if (msg.type === "user") {
          const content = msg.message?.content;
          let text = "";

          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            const texts: string[] = [];
            for (const c of content) {
              if (c?.type === "text" && c.text) texts.push(c.text);
            }
            text = texts.join("\n");
          }

          if (!text.trim()) continue;

          text = text
            .replace(/<command-message>[^<]*<\/command-message>\s*/g, "")
            .replace(/<command-name>([^<]*)<\/command-name>/g, "$1")
            .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
            .trim();

          if (!text) continue;
          messages.push({ role: "user", text });
        } else if (msg.type === "assistant") {
          const content = msg.message?.content;

          if (typeof content === "string" && content.trim()) {
            messages.push({ role: "assistant", text: content });
          } else if (Array.isArray(content)) {
            const texts: string[] = [];
            for (const c of content) {
              if (c?.type === "text" && c.text?.trim()) texts.push(c.text);
            }
            if (texts.length > 0) {
              messages.push({ role: "assistant", text: texts.join("\n") });
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return Response.json({ sessionId, messages, running: isRunning(sessionId) });
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
}
