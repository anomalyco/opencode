import { Database } from "bun:sqlite"

const SOURCE_SIGNATURE_SESSION_MESSAGE = "session_message:v1:id,session_id,type,seq,time_created,data"
const SOURCE_SIGNATURE_MESSAGE_PART = "message_part:v1:message(id,session_id,time_created,data)+part(message_id,time_created,data)"

export function detectSourceMode(db: Database) {
  if (hasSessionMessageContent(db)) return "session_message" as const
  if (hasLegacyMessagePartContent(db)) return "message_part" as const
  throw new Error("source opencode.db has no supported conversation content in session_message or message/part")
}

export function ensureIndexSchema(db: Database) {
  db.exec("pragma journal_mode = wal")
  db.exec("pragma synchronous = normal")
  db.exec("pragma busy_timeout = 5000")
  db.exec(`
    create table if not exists schema_meta (
      key text primary key,
      value text not null,
      updated_at integer not null
    );

    create table if not exists conversation_index (
      id integer primary key autoincrement,
      message_id text not null unique,
      session_id text not null,
      seq integer not null,
      role text not null,
      created_at integer not null,
      text text not null,
      source_checksum text not null,
      stale integer not null default 0,
      synced_at integer not null
    );

    create virtual table if not exists conversation_fts using fts5(
      text,
      content='conversation_index',
      content_rowid='id'
    );

    create trigger if not exists conversation_index_ai after insert on conversation_index begin
      insert into conversation_fts(rowid, text) values (new.id, new.text);
    end;

    create trigger if not exists conversation_index_ad after delete on conversation_index begin
      insert into conversation_fts(conversation_fts, rowid, text) values ('delete', old.id, old.text);
    end;

    create trigger if not exists conversation_index_au after update on conversation_index begin
      insert into conversation_fts(conversation_fts, rowid, text) values ('delete', old.id, old.text);
      insert into conversation_fts(rowid, text) values (new.id, new.text);
    end;

    create index if not exists conversation_index_session_created_idx on conversation_index(session_id, created_at);
    create index if not exists conversation_index_created_idx on conversation_index(created_at);
    create index if not exists conversation_index_stale_idx on conversation_index(stale, created_at);

    create table if not exists memory_note (
      id text primary key,
      title text not null,
      body text not null,
      memory_type text not null,
      tags text not null,
      importance integer not null,
      status text not null,
      scope text not null,
      source_session_id text,
      source_message_ids text not null,
      created_at integer not null,
      updated_at integer not null
    );

    create virtual table if not exists memory_note_fts using fts5(
      title,
      body,
      content='memory_note',
      content_rowid='rowid'
    );

    create trigger if not exists memory_note_ai after insert on memory_note begin
      insert into memory_note_fts(rowid, title, body) values (new.rowid, new.title, new.body);
    end;

    create trigger if not exists memory_note_ad after delete on memory_note begin
      insert into memory_note_fts(memory_note_fts, rowid, title, body) values ('delete', old.rowid, old.title, old.body);
    end;

    create trigger if not exists memory_note_au after update on memory_note begin
      insert into memory_note_fts(memory_note_fts, rowid, title, body) values ('delete', old.rowid, old.title, old.body);
      insert into memory_note_fts(rowid, title, body) values (new.rowid, new.title, new.body);
    end;

    create index if not exists memory_note_updated_idx on memory_note(updated_at);
  `)
  const columns = db.query<{ name: string }, []>("pragma table_info(conversation_index)").all().map((row) => row.name)
  if (!columns.includes("stale")) db.exec("alter table conversation_index add column stale integer not null default 0")
  verifySourceSignature(db)
}

export function upsertMeta(db: Database, key: string, value: string) {
  db.query(
    "insert into schema_meta (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Date.now())
}

export function shouldFullResync(db: Database, sourceDbPath: string) {
  return readMeta(db, "source_db_path") !== sourceDbPath || !readMeta(db, "last_cursor_created_at")
}

export function readSyncCursor(db: Database, sourceDbPath: string): { createdAt: number; messageID: string } | undefined {
  if (readMeta(db, "source_db_path") !== sourceDbPath) return undefined
  const createdAt = Number(readMeta(db, "last_cursor_created_at") ?? 0)
  const messageID = readMeta(db, "last_cursor_message_id") ?? ""
  if (!createdAt || !messageID) return undefined
  return { createdAt, messageID }
}

export function readMeta(db: Database, key: string) {
  const row = db.query<{ value: string }, [string]>("select value from schema_meta where key = ? limit 1").get(key)
  return row?.value
}

function verifySourceSignature(db: Database) {
  const stored = readMeta(db, "source_signature")
  if (!stored || stored === SOURCE_SIGNATURE_SESSION_MESSAGE || stored === SOURCE_SIGNATURE_MESSAGE_PART) return
  throw new Error(`source signature mismatch: unsupported stored signature ${stored}`)
}

function hasSessionMessageContent(db: Database) {
  const table = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' and name = 'session_message' limit 1")
    .get()
  if (!table) return false
  const columns = db.query<{ name: string }, []>("pragma table_info(session_message)").all().map((row) => row.name)
  const required = ["id", "session_id", "type", "seq", "time_created", "data"]
  if (required.some((name) => !columns.includes(name))) return false
  const count = db
    .query<{ count: number }, []>("select count(*) as count from session_message where type in ('user', 'assistant')")
    .get()
  return (count?.count ?? 0) > 0
}

function hasLegacyMessagePartContent(db: Database) {
  const messageTable = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' and name = 'message' limit 1")
    .get()
  const partTable = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' and name = 'part' limit 1")
    .get()
  if (!messageTable || !partTable) return false
  const messageColumns = db.query<{ name: string }, []>("pragma table_info(message)").all().map((row) => row.name)
  const partColumns = db.query<{ name: string }, []>("pragma table_info(part)").all().map((row) => row.name)
  const messageRequired = ["id", "session_id", "time_created", "data"]
  const partRequired = ["message_id", "time_created", "data"]
  if (messageRequired.some((name) => !messageColumns.includes(name))) return false
  if (partRequired.some((name) => !partColumns.includes(name))) return false
  const count = db.query<{ count: number }, []>("select count(*) as count from message").get()
  return (count?.count ?? 0) > 0
}

export const SourceSignature = {
  sessionMessage: SOURCE_SIGNATURE_SESSION_MESSAGE,
  messagePart: SOURCE_SIGNATURE_MESSAGE_PART,
} as const
