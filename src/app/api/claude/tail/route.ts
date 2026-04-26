import { NextRequest } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import { isRunning, isValidSessionId, logPathFor } from "@/lib/claude-sessions";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!isValidSessionId(sessionId)) {
    return Response.json({ error: "invalid sessionId" }, { status: 400 });
  }

  const logPath = logPathFor(sessionId);
  if (!existsSync(logPath)) {
    return Response.json({ error: "no log for session" }, { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let pos = 0;
      let aborted = false;
      const onAbort = () => { aborted = true; };
      req.signal.addEventListener("abort", onAbort);

      const readNew = async (): Promise<boolean> => {
        try {
          const { size } = await stat(logPath);
          if (size <= pos) return false;
          await new Promise<void>((resolve) => {
            const rs = createReadStream(logPath, { start: pos, end: size - 1 });
            rs.on("data", (chunk) => {
              if (aborted) return;
              try {
                const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
                controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
              } catch {
                aborted = true;
              }
            });
            rs.on("end", () => { pos = size; resolve(); });
            rs.on("error", () => resolve());
          });
          return true;
        } catch {
          return false;
        }
      };

      await readNew();

      let drainedCount = 0;
      while (!aborted) {
        const stillRunning = isRunning(sessionId);
        const updated = await readNew();
        if (!stillRunning) {
          if (updated) drainedCount = 0;
          else drainedCount++;
          if (drainedCount >= 2) break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      req.signal.removeEventListener("abort", onAbort);
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
