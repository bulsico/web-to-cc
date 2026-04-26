"use client";

import { useCallback, useEffect, useState } from "react";
import { MarkdownHooks as ReactMarkdown } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";

const REMARK_PLUGINS = [remarkGfm];

interface MemoryFile {
  filename: string;
  name: string;
  description: string;
  type: string;
  body: string;
  updatedAt: number;
}

interface MemoryResponse {
  files: MemoryFile[];
  index: string;
}

const TYPE_COLORS: Record<string, string> = {
  user: "bg-blue-600/20 text-blue-400 border-blue-600/40",
  feedback: "bg-amber-600/20 text-amber-400 border-amber-600/40",
  project: "bg-green-600/20 text-green-400 border-green-600/40",
  reference: "bg-purple-600/20 text-purple-400 border-purple-600/40",
  unknown: "bg-surface-hover text-muted border-border",
};

export default function MemoryPage() {
  const [data, setData] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showIndex, setShowIndex] = useState(false);

  const load = useCallback(() => {
    fetch("/api/memory")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRefetchOnFocus(load);

  function toggle(filename: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  const files = data?.files ?? [];
  const types = [...new Set(files.map((f) => f.type))].sort();
  const filtered = typeFilter ? files.filter((f) => f.type === typeFilter) : files;

  return (
    <main className="max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Memory</h1>
        <p className="text-sm text-muted mt-1">
          Persistent notes Claude carries across conversations in this project.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-fg text-sm">Loading...</p>
      ) : files.length === 0 ? (
        <p className="text-muted-fg text-sm py-8 text-center">No memories saved yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <button
              onClick={() => setTypeFilter(null)}
              className={`px-3 py-1.5 text-xs rounded ${
                !typeFilter ? "bg-surface-hover text-foreground" : "bg-surface text-muted hover:text-foreground"
              }`}
            >
              All ({files.length})
            </button>
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs rounded capitalize ${
                  typeFilter === t ? "bg-surface-hover text-foreground" : "bg-surface text-muted hover:text-foreground"
                }`}
              >
                {t} ({files.filter((f) => f.type === t).length})
              </button>
            ))}
            {data?.index && (
              <button
                onClick={() => setShowIndex(!showIndex)}
                className="ml-auto px-3 py-1.5 text-xs rounded bg-surface text-muted hover:text-foreground"
              >
                {showIndex ? "Hide index" : "Show MEMORY.md"}
              </button>
            )}
          </div>

          {showIndex && data?.index && (
            <div className="mb-4 p-4 bg-surface border border-border rounded-lg">
              <div className="text-xs text-muted uppercase tracking-wide mb-2">MEMORY.md</div>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{data.index}</ReactMarkdown>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {filtered.map((f) => {
              const isOpen = expanded.has(f.filename);
              return (
                <div key={f.filename} className="border border-border rounded-lg bg-surface">
                  <button
                    onClick={() => toggle(f.filename)}
                    className="w-full text-left p-4 hover:bg-surface-hover transition"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded border capitalize ${
                          TYPE_COLORS[f.type] || TYPE_COLORS.unknown
                        }`}
                      >
                        {f.type}
                      </span>
                      <span className="text-sm font-medium">{f.name}</span>
                      <span className="text-xs text-muted-fg ml-auto whitespace-nowrap">
                        {new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {f.description && (
                      <p className="text-xs text-muted leading-relaxed">{f.description}</p>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-0 border-t border-border">
                      <div className="prose prose-sm max-w-none dark:prose-invert pt-3 [&_table]:block [&_table]:overflow-x-auto [&_pre]:overflow-x-auto">
                        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{f.body}</ReactMarkdown>
                      </div>
                      <div className="text-xs text-muted-fg mt-2 font-mono">{f.filename}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
