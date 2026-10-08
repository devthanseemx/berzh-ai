import Database from "@tauri-apps/plugin-sql";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Doc, Message, Session } from "./types";

export const newSession = (): Session => ({
  id: crypto.randomUUID(),
  title: "New chat",
  messages: [],
  docs: [],
});

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load("sqlite:berzh-ai.db");
      await db.execute(
        `CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          source TEXT,
          created_at INTEGER NOT NULL
        )`
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS docs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          idx INTEGER NOT NULL,
          text TEXT NOT NULL
        )`
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)"
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_docs_session ON docs(session_id)"
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id)"
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)"
      );
      return db;
    })();
  }
  return dbPromise;
}

type SessionRow = { id: string; title: string };
type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  text: string;
  source: Message["source"] | null;
};
type DocRow = { id: string; session_id: string; name: string; path: string };

async function loadSessions(): Promise<Session[]> {
  const db = await getDb();
  const sessions = await db.select<SessionRow[]>(
    "SELECT id, title FROM sessions ORDER BY created_at DESC"
  );
  const messages = await db.select<MessageRow[]>(
    "SELECT id, session_id, role, text, source FROM messages ORDER BY created_at, rowid"
  );
  const docs = await db.select<DocRow[]>(
    "SELECT id, session_id, name, path FROM docs ORDER BY created_at, rowid"
  );

  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    messages: messages
      .filter((m) => m.session_id === s.id)
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        source: m.source ?? undefined,
      })),
    docs: docs
      .filter((d) => d.session_id === s.id)
      .map((d) => ({ id: d.id, name: d.name, path: d.path })),
  }));
}

// Shared promise: React StrictMode runs effects twice in dev.
let initPromise: Promise<Session[]> | null = null;

export function initSessions(): Promise<Session[]> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDb();
      // Files from the old version have no searchable text: drop them
      await db.execute(
        "DELETE FROM docs WHERE id NOT IN (SELECT doc_id FROM chunks)"
      );
      // Empty chats are never kept in history
      await db.execute(
        `DELETE FROM sessions
         WHERE id NOT IN (SELECT session_id FROM messages)
           AND id NOT IN (SELECT session_id FROM docs)`
      );
      return loadSessions();
    })();
  }
  return initPromise;
}

export async function insertSession(s: Pick<Session, "id" | "title">) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO sessions (id, title, created_at) VALUES ($1, $2, $3)",
    [s.id, s.title, Date.now()]
  );
}

export async function updateTitle(id: string, title: string) {
  const db = await getDb();
  await db.execute("UPDATE sessions SET title = $1 WHERE id = $2", [title, id]);
}

export async function deleteSession(id: string) {
  const db = await getDb();
  await db.execute("DELETE FROM chunks WHERE session_id = $1", [id]);
  await db.execute("DELETE FROM messages WHERE session_id = $1", [id]);
  await db.execute("DELETE FROM docs WHERE session_id = $1", [id]);
  await db.execute("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function insertMessages(sessionId: string, msgs: Message[]) {
  const db = await getDb();
  for (const m of msgs) {
    await db.execute(
      "INSERT INTO messages (id, session_id, role, text, source, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [m.id, sessionId, m.role, m.text, m.source ?? null, Date.now()]
    );
  }
}

export async function deleteDoc(id: string) {
  const db = await getDb();
  await db.execute("DELETE FROM chunks WHERE doc_id = $1", [id]);
  await db.execute("DELETE FROM docs WHERE id = $1", [id]);
}

/** Save a document and its text chunks. Removes everything again if something fails. */
export async function insertDoc(sessionId: string, doc: Doc, chunks: string[]) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO docs (id, session_id, name, path, created_at) VALUES ($1, $2, $3, $4, $5)",
    [doc.id, sessionId, doc.name, doc.path, Date.now()]
  );
  try {
    const BATCH = 40;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const part = chunks.slice(i, i + BATCH);
      const values: string[] = [];
      const params: (string | number)[] = [];
      part.forEach((text, j) => {
        const n = j * 5;
        values.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5})`);
        params.push(crypto.randomUUID(), doc.id, sessionId, i + j, text);
      });
      await db.execute(
        `INSERT INTO chunks (id, doc_id, session_id, idx, text) VALUES ${values.join(", ")}`,
        params
      );
    }
  } catch (e) {
    await deleteDoc(doc.id);
    throw e;
  }
}

export interface ChunkRow {
  id: string;
  doc_id: string;
  doc_name: string;
  text: string;
}

export async function loadChunks(sessionId: string): Promise<ChunkRow[]> {
  const db = await getDb();
  return db.select<ChunkRow[]>(
    `SELECT c.id AS id, c.doc_id AS doc_id, d.name AS doc_name, c.text AS text
     FROM chunks c JOIN docs d ON d.id = c.doc_id
     WHERE c.session_id = $1
     ORDER BY d.created_at, c.idx`,
    [sessionId]
  );
}

/* ---------- settings ---------- */

async function ensureSettingsTable(db: Database) {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
}

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  await ensureSettingsTable(db);
  // Gemini was removed: erase its stored key and leftovers
  await db.execute("DELETE FROM settings WHERE key LIKE 'gemini%' OR key = 'provider'");
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings"
  );
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = { ...DEFAULT_SETTINGS, ...stored } as Settings;
  const bool = (v: unknown) => String(v) === "true";

  // the old built-in "tell me about yourself" text is replaced by the "Answer as me" switch
  const instructions = merged.instructions.startsWith(
    'When I ask you to "tell me about yourself"'
  )
    ? ""
    : merged.instructions;

  return {
    ...merged,
    instructions,
    liveDraft: bool(merged.liveDraft),
    humanTone: bool(merged.humanTone),
    answerAsMe: bool(merged.answerAsMe),
  };
}

export async function saveSettings(s: Settings) {
  const db = await getDb();
  await ensureSettingsTable(db);
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, String(s[key])]
    );
  }
}