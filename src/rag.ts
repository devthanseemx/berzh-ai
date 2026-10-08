import { loadChunks } from "./db";

const FULL_LIMIT = 8000; // small document sets are sent whole
const TOP_K = 5;
const K1 = 1.5;
const B = 0.75;

const STOP = new Set(
  ("a an the and or but if then of to in on at by for with about as is are was were be been am do does did " +
    "have has had i me my you your he she it we they them this that these those what which who whom how why " +
    "when where can could should would will shall may might not no yes so than too very just tell please give").split(" ")
);

const tokenize = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !STOP.has(w));

interface Chunk {
  docName: string;
  text: string;
  len: number;
  tf: Map<string, number>;
}

interface Index {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLen: number;
  totalChars: number;
}

export interface DocHit {
  context: string; // text to give the AI
  files: string[];
  relevant: boolean; // the question actually matches the documents
}

const cache = new Map<string, Promise<Index>>();

/** Call after documents of a session were added, removed or deleted. */
export const invalidateIndex = (sessionId: string) => {
  cache.delete(sessionId);
};

async function build(sessionId: string): Promise<Index> {
  const rows = await loadChunks(sessionId);
  const chunks: Chunk[] = rows.map((r) => {
    const tokens = tokenize(r.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { docName: r.doc_name, text: r.text, len: tokens.length, tf };
  });

  const df = new Map<string, number>();
  for (const c of chunks) {
    for (const t of c.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const totalLen = chunks.reduce((n, c) => n + c.len, 0);
  return {
    chunks,
    df,
    avgLen: totalLen / (chunks.length || 1) || 1,
    totalChars: chunks.reduce((n, c) => n + c.text.length, 0),
  };
}

function getIndex(sessionId: string): Promise<Index> {
  let p = cache.get(sessionId);
  if (!p) {
    p = build(sessionId);
    cache.set(sessionId, p);
  }
  return p;
}

export async function searchDocs(
  sessionId: string,
  query: string
): Promise<DocHit | null> {
  const idx = await getIndex(sessionId);
  const N = idx.chunks.length;
  if (N === 0) return null;

  const q = Array.from(new Set(tokenize(query)));
  const scores = idx.chunks.map((c) => {
    let s = 0;
    for (const t of q) {
      const f = c.tf.get(t);
      if (!f) continue;
      const n = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * c.len) / idx.avgLen)));
    }
    return s;
  });
  const relevant = scores.some((s) => s > 0);

  let picked: Chunk[];
  if (idx.totalChars <= FULL_LIMIT) {
    picked = idx.chunks; // small: give the AI everything
  } else if (relevant) {
    picked = scores
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, TOP_K)
      .sort((a, b) => a.i - b.i)
      .map((x) => idx.chunks[x.i]);
  } else {
    return null; // large documents, nothing matches: answer normally
  }

  let context = "";
  let lastDoc = "";
  for (const c of picked) {
    if (c.docName !== lastDoc) {
      context += `${context ? "\n\n" : ""}[File: ${c.docName}]\n`;
      lastDoc = c.docName;
    }
    context += c.text + "\n";
  }
  const files = Array.from(new Set(picked.map((c) => c.docName)));
  return { context: context.trim(), files, relevant };
}