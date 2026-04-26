import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { config } from "@/lib/config";

interface MemoryFile {
  filename: string;
  name: string;
  description: string;
  type: string;
  body: string;
  updatedAt: number;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

export async function GET() {
  try {
    const entries = await readdir(config.memoryDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

    const files: MemoryFile[] = [];
    for (const filename of mdFiles) {
      const filePath = path.join(config.memoryDir, filename);
      try {
        const [raw, fileStat] = await Promise.all([
          readFile(filePath, "utf-8"),
          stat(filePath),
        ]);
        const { meta, body } = parseFrontmatter(raw);
        files.push({
          filename,
          name: meta.name || filename.replace(/\.md$/, ""),
          description: meta.description || "",
          type: meta.type || "unknown",
          body,
          updatedAt: fileStat.mtimeMs,
        });
      } catch {
        // skip unreadable files
      }
    }

    let index = "";
    try {
      index = await readFile(path.join(config.memoryDir, "MEMORY.md"), "utf-8");
    } catch {
      // no index
    }

    files.sort((a, b) => b.updatedAt - a.updatedAt);

    return Response.json({ files, index });
  } catch {
    return Response.json({ files: [], index: "" });
  }
}
