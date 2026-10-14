import { fetch } from "@tauri-apps/plugin-http";
import { ConfigError } from "./llm";
import type { Ref } from "./types";

export interface WebHit {
  context: string; // text given to the AI
  refs: Ref[]; // links shown under the answer
}

export interface WebOptions {
  /** Tavily topic: general, news, or finance */
  topic: "general" | "news" | "finance";
}

const auth = (apiKey: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey.trim()}`,
});

export async function searchWeb(
  apiKey: string,
  query: string,
  opts: WebOptions,
  signal: AbortSignal
): Promise<WebHit | null> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: auth(apiKey),
    body: JSON.stringify({
      query: query.slice(0, 380),
      // always "basic": exactly 1 Tavily credit per search (advanced costs 2,
      // the Research API costs 4-110 - far too much for a chat question)
      search_depth: "basic",
      topic: opts.topic,
      max_results: 5,
    }),
    signal,
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new ConfigError("Invalid Tavily API key. Check it in Settings.");
    }
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(`Web search failed (HTTP ${res.status}) ${detail}`.trim());
  }

  const json: any = await res.json();
  const items: any[] = (Array.isArray(json.results) ? json.results : [])
    .filter((r: any) => r?.url && r?.content)
    .slice(0, 5);
  if (items.length === 0) return null;

  const context = items
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title ?? r.url} (${r.url})\n${String(r.content).slice(0, 700)}`
    )
    .join("\n\n");
  const refs: Ref[] = items.map((r) => ({
    title: String(r.title ?? r.url),
    url: String(r.url),
  }));
  return { context, refs };
}
