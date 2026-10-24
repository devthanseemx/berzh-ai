import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <div className="code-block">
      <button className="code-copy" onClick={copy} title="Copy code">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault(); // never navigate the app window
        if (href && /^(https?:|mailto:)/i.test(href)) openUrl(href).catch(console.error);
      }}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => {
    const code = Array.isArray(children) ? children[0] : children;
    const cls = String((code as any)?.props?.className ?? "");
    const body = String((code as any)?.props?.children ?? "");
    if (cls.includes("language-mermaid") && body.trim()) {
      return <Mermaid code={body} />;
    }
    return <CodeBlock>{children}</CodeBlock>;
  },
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

/** ```mermaid fences render as a picture; the library loads only when one appears. */
function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        const normalizedCode = code
          .replace(/^\s*[\w.-]+\s+--\s+-{3,}\s*;?\s*$/gm, "")
          .replace(
            /(\b[\w.-]+)\{([^{}\n"]*\?[^{}\n"]*)\}/g,
            '$1{"$2"}',
          );
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "neutral",
          fontFamily: "Inter, system-ui, sans-serif",
          suppressErrorRendering: true,
        });
        const parsed = await mermaid.parse(normalizedCode, { suppressErrors: true });
        if (!parsed) {
          if (!dead) setFailed(true);
          return;
        }
        const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, normalizedCode);
        if (!dead && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [code]);

  if (failed) {
    return (
      <CodeBlock>
        <code>{code}</code>
      </CodeBlock>
    );
  }
  return <div className="mermaid-wrap" ref={ref} />;
}

function MarkdownBase({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownBase);