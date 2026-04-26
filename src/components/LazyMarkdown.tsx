"use client";

import { memo, useEffect, useRef, useState } from "react";
import { MarkdownHooks as ReactMarkdown } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

interface LazyMarkdownProps {
  children: string;
  rootMargin?: string;
  alwaysRenderUnderChars?: number;
}

const LazyMarkdownInner = function LazyMarkdownInner({
  children,
  rootMargin = "800px",
  alwaysRenderUnderChars = 1200,
}: LazyMarkdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const renderEagerly =
    children.length < alwaysRenderUnderChars ||
    typeof IntersectionObserver === "undefined";
  const [mounted, setMounted] = useState(renderEagerly);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, rootMargin]);

  return (
    <div ref={ref}>
      {mounted ? (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{children}</ReactMarkdown>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
          {children}
        </pre>
      )}
    </div>
  );
};

export const LazyMarkdown = memo(LazyMarkdownInner);
