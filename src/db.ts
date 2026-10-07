import Database from "@tauri-apps/plugin-sql";
import type { Doc, Message, Session } from "./types";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

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
        "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)"
      );
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_docs_session ON docs(session_id)"
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

// Shared promise: React StrictMode runs effects twice in dev,
// this makes sure the first session is only created once.
let initPromise: Promise<Session[]> | null = null;

export function initSessions(): Promise<Session[]> {
  if (!initPromise) {
    initPromise = (async () => {
      let sessions = await loadSessions();
      if (sessions.length === 0) {
        const s = newSession();
        await insertSession(s);
        sessions = [s];
      }
      return sessions;
    })();
  }
  return initPromise;
}

export async function insertSession(s: Session) {
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

export async function insertDocs(sessionId: string, docs: Doc[]) {
  const db = await getDb();
  for (const d of docs) {
    await db.execute(
      "INSERT INTO docs (id, session_id, name, path, created_at) VALUES ($1, $2, $3, $4, $5)",
      [d.id, sessionId, d.name, d.path, Date.now()]
    );
  }
}

export async function deleteDoc(id: string) {
  const db = await getDb();
  await db.execute("DELETE FROM docs WHERE id = $1", [id]);
}

async function ensureSettingsTable(db: Database) {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
}

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  await ensureSettingsTable(db);
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings"
  );
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(s: Settings) {
  const db = await getDb();
  await ensureSettingsTable(db);
  for (const [key, value] of Object.entries(s)) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, String(value)]
    );
  }
}