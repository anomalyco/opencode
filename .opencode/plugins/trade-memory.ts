import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"

const DEFAULT_OPENCODE_DB = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode", "opencode.db")
const DEFAULT_MEMORY_DB = path.join(process.env.OPENCODE_TRADE_DATA_DIR ?? path.join(os.homedir(), ".local", "share", "opencode-trade"), "memory.sqlite3")
const DEFAULT_OPENCODE_DATA_DIR = path.dirname(DEFAULT_OPENCODE_DB)
const DEFAULT_OPENCODE_DB_CANDIDATES = [DEFAULT_OPENCODE_DB, path.join(DEFAULT_OPENCODE_DATA_DIR, "opencode-beta.db")]
const SOURCE_SIGNATURE_SESSION_MESSAGE = "session_message:v1:id,session_id,type,seq,time_created,data"
const SOURCE_SIGNATURE_MESSAGE_PART = "message_part:v1:message(id,session_id,time_created,data)+part(message_id,time_created,data)"
const NOTE_STATUSES = ["active", "tentative", "deprecated"] as const
const SEARCH_WARNING = "warning: FTS unavailable, using LIKE fallback"
const AUTO_SYNC_DELAY_MS = Number(process.env.OPENCODE_TRADE_AUTO_SYNC_DELAY_MS ?? 4000)
const AUTO_SYNC_MIN_INTERVAL_MS = Number(process.env.OPENCODE_TRADE_AUTO_SYNC_MIN_INTERVAL_MS ?? 15000)

type NoteStatus = (typeof NOTE_STATUSES)[number]
type SourceRow = {
  id: string
  session_id: string
  seq: number
  type: string
  time_created: number
  data: string
}

type LegacyMessageRow = {
  id: string
  session_id: string
  time_created: number
  data: string
}

type LegacyPartRow = {
  id: string
  message_id: string
  session_id: string
  time_created: number
  data: string
}

type ConversationRow = {
  messageID: string
  sessionID: string
  seq: number
  role: "user" | "assistant"
  createdAt: number
  text: string
  checksum: string
}

type MemoryNoteRow = {
  id: string
  title: string
  body: string
  memory_type: string
  tags: string
  importance: number
  status: NoteStatus
  scope: string
  source_session_id: string | null
  source_message_ids: string
  created_at: number
  updated_at: number
}

type SearchResult<Row> = {
  rows: Row[]
  warning?: string
}

type SyncReport = {
  count: number
  fullResync: boolean
  sourceDbPath: string
  indexDbPath: string
  sourceMode: "session_message" | "message_part"
}

type SessionMessageUser = {
  type: "user"
  text?: unknown
}

type SessionMessageAssistant = {
  type: "assistant"
  content?: unknown
}

type LegacyMessageData = {
  role?: unknown
}

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
]

export default (async () => {
  let autoSyncTimer: ReturnType<typeof setTimeout> | undefined
  let lastAutoSyncStartedAt = 0
  let pendingAutoSync: { fullResync: boolean; reason: string } | undefined
  let runningAutoSync: Promise<void> | undefined

  const scheduleAutoSync = (input: { fullResync?: boolean; reason: string; delayMs?: number }) => {
    const nextDelay = input.delayMs ?? AUTO_SYNC_DELAY_MS
    const fullResync = input.fullResync ?? false
    pendingAutoSync = pendingAutoSync
      ? { fullResync: pendingAutoSync.fullResync || fullResync, reason: `${pendingAutoSync.reason}, ${input.reason}` }
      : { fullResync, reason: input.reason }
    if (autoSyncTimer) clearTimeout(autoSyncTimer)
    const waitMs = Math.max(nextDelay, AUTO_SYNC_MIN_INTERVAL_MS - (Date.now() - lastAutoSyncStartedAt), 0)
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = undefined
      void flushAutoSync()
    }, waitMs)
  }

  const flushAutoSync = () => {
    if (runningAutoSync) return runningAutoSync
    if (!pendingAutoSync) return Promise.resolve()
    const job = pendingAutoSync
    pendingAutoSync = undefined
    lastAutoSyncStartedAt = Date.now()
    runningAutoSync = Promise.resolve()
      .then(() => syncTradeMemoryNow({ fullResync: job.fullResync }))
      .catch((error) => {
        console.warn(`[trade-memory] auto sync failed (${job.reason})`, error)
      })
      .finally(() => {
        runningAutoSync = undefined
        if (pendingAutoSync) void flushAutoSync()
      })
    return runningAutoSync
  }

  const syncTradeMemoryNow = (args: {
    sourceDbPath?: string
    indexDbPath?: string
    fullResync?: boolean
  }): SyncReport => {
    const sourceDbPath = resolveSourceDbPath(args.sourceDbPath ?? process.env.OPENCODE_DB)
    const indexDbPath = args.indexDbPath ?? DEFAULT_MEMORY_DB
    let sourceDb: Database | undefined
    let indexDb: Database | undefined

    try {
      sourceDb = openDatabase(sourceDbPath, true)
      indexDb = openDatabase(indexDbPath, false)
      const sourceMode = detectSourceMode(sourceDb)
      ensureIndexSchema(indexDb)
      const syncedAt = Date.now()
      const fullResync = args.fullResync ?? shouldFullResync(indexDb, sourceDbPath)
      const lastCursor = fullResync ? undefined : readSyncCursor(indexDb, sourceDbPath)
      const insert = indexDb.query(
        "insert into conversation_index (message_id, session_id, seq, role, created_at, text, source_checksum, stale, synced_at) values (?, ?, ?, ?, ?, ?, ?, 0, ?) on conflict(message_id) do update set session_id = excluded.session_id, seq = excluded.seq, role = excluded.role, created_at = excluded.created_at, text = excluded.text, source_checksum = excluded.source_checksum, stale = 0, synced_at = excluded.synced_at",
      )
      const count = { value: 0 }
      const cursor = { createdAt: lastCursor?.createdAt ?? 0, messageID: lastCursor?.messageID ?? "" }

      indexDb.transaction(() => {
        if (fullResync) indexDb.query("update conversation_index set stale = 1").run()
        streamConversationRows(sourceDb, sourceMode, lastCursor).forEach((row) => {
          insert.run(row.messageID, row.sessionID, row.seq, row.role, row.createdAt, row.text, row.checksum, syncedAt)
          count.value += 1
          cursor.createdAt = row.createdAt
          cursor.messageID = row.messageID
        })
        if (fullResync) indexDb.query("delete from conversation_index where stale = 1").run()
        upsertMeta(
          indexDb,
          "source_signature",
          sourceMode === "session_message" ? SOURCE_SIGNATURE_SESSION_MESSAGE : SOURCE_SIGNATURE_MESSAGE_PART,
        )
        upsertMeta(indexDb, "last_sync_at", String(syncedAt))
        upsertMeta(indexDb, "source_db_path", sourceDbPath)
        upsertMeta(indexDb, "source_mode", sourceMode)
        upsertMeta(indexDb, "last_sync_mode", fullResync ? "full" : "incremental")
        if (count.value) {
          upsertMeta(indexDb, "last_cursor_created_at", String(cursor.createdAt))
          upsertMeta(indexDb, "last_cursor_message_id", cursor.messageID)
        }
      })()

      return {
        count: count.value,
        fullResync,
        sourceDbPath,
        indexDbPath,
        sourceMode,
      }
    } finally {
      sourceDb?.close(false)
      indexDb?.close(false)
    }
  }

  return {
    dispose: async () => {
      if (autoSyncTimer) clearTimeout(autoSyncTimer)
    },
    config: async () => {
      scheduleAutoSync({ reason: "startup", delayMs: 0 })
    },
    event: async (input) => {
      scheduleAutoSync({ reason: `event:${input.event.type}` })
    },
    "chat.message": async () => {
      scheduleAutoSync({ reason: "chat.message" })
    },
    "tool.execute.after": async (input) => {
      if (input.tool === "sync_trade_memory") return
      scheduleAutoSync({ reason: `tool.execute.after:${input.tool}` })
    },
    tool: {
      // Core retrieval path: sync, search, and source inspection.
      sync_trade_memory: tool({
        description:
          "Sync user messages and assistant final text from opencode.db into the external trade memory SQLite index.",
        args: {
          source_db_path: tool.schema.string().optional().describe("Optional path to the source opencode.db."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
          full_resync: tool.schema.boolean().optional().describe("Force a full resync and stale reconciliation."),
        },
        async execute(args) {
          const result = syncTradeMemoryNow({
            sourceDbPath: args.source_db_path,
            indexDbPath: args.index_db_path,
            fullResync: args.full_resync,
          })
          return [
            `synced: ${result.count} messages`,
            `sync_mode: ${result.fullResync ? "full" : "incremental"}`,
            `source_mode: ${result.sourceMode}`,
            `source_db: ${result.sourceDbPath}`,
            `index_db: ${result.indexDbPath}`,
            "indexed_roles: user, assistant(text only)",
          ].join("\n")
        },
      }),
      search_trade_conversations: tool({
        description:
          "Search the external trade memory full-text index for prior user messages and assistant final text.",
        args: {
          query: tool.schema.string().describe("FTS query string. Use plain keywords unless you need FTS operators."),
          limit: tool.schema.number().int().min(1).max(20).optional().describe("Maximum number of hits."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = args.index_db_path ?? DEFAULT_MEMORY_DB
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const limit = args.limit ?? 8
            const result = runConversationSearch(indexDb, args.query, limit)
            if (!result.rows.length) return result.warning ? `${result.warning}\nno conversation hits for: ${args.query}` : `no conversation hits for: ${args.query}`
            const body = result.rows
              .map((row, index) => {
                return [
                  `${index + 1}. [${row.role}] session=${row.session_id} seq=${row.seq} created_at=${row.created_at}`,
                  `message_id: ${row.message_id}`,
                  `snippet: ${row.snippet}`,
                ].join("\n")
              })
              .join("\n\n")
            return result.warning ? `${result.warning}\n${body}` : body
          } finally {
            indexDb.close(false)
          }
        },
      }),
      open_trade_conversation_source: tool({
        description:
          "Open one indexed source message from opencode.db to inspect the original user text or assistant final text.",
        args: {
          message_id: tool.schema.string().describe("Message ID from search_trade_conversations results."),
          source_db_path: tool.schema.string().optional().describe("Optional path to the source opencode.db."),
        },
        async execute(args) {
          const sourceDbPath = resolveSourceDbPath(args.source_db_path ?? process.env.OPENCODE_DB)
          let sourceDb: Database | undefined

          try {
            sourceDb = openDatabase(sourceDbPath, true)
            const sourceMode = detectSourceMode(sourceDb)
            if (sourceMode === "session_message") {
              const row = readSessionMessageSource(sourceDb, args.message_id)
              if (!row) return `source message not found: ${args.message_id}`
              const text = extractRedactedSearchableText(row)
              if (!text) return `source message is not indexed content: ${args.message_id}`
              return [
                `role: ${row.type}`,
                `session_id: ${row.session_id}`,
                `message_id: ${row.id}`,
                `seq: ${row.seq}`,
                `created_at: ${row.time_created}`,
                "text:",
                text,
              ].join("\n")
            }
            const legacy = readLegacyConversationRow(sourceDb, args.message_id)
            if (!legacy) return `source message not found: ${args.message_id}`
            return [
              `role: ${legacy.role}`,
              `session_id: ${legacy.sessionID}`,
              `message_id: ${legacy.messageID}`,
              `seq: ${legacy.seq}`,
              `created_at: ${legacy.createdAt}`,
              "text:",
              legacy.text,
            ].join("\n")
          } finally {
            sourceDb?.close(false)
          }
        },
      }),
      // Optional curation path: useful for explicit notes, but not required for normal operation.
      store_trade_memory_note: tool({
        description:
          "Store a curated memory note for a decision, rejection reason, unresolved issue, or Oracle note.",
        args: {
          title: tool.schema.string().min(1).describe("Short title for the memory note."),
          body: tool.schema.string().min(1).describe("The note body to preserve."),
          memory_type: tool.schema.string().min(1).describe("Examples: decision, rejection, risk, oracle-note, unresolved."),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Optional tags."),
          importance: tool.schema.number().int().min(1).max(5).optional().describe("Importance from 1 to 5."),
          status: tool.schema.enum(NOTE_STATUSES).optional().describe("active, tentative, or deprecated."),
          scope: tool.schema.string().optional().describe("Optional scope such as global, project, phase1, oracle."),
          source_session_id: tool.schema.string().optional().describe("Optional source session ID."),
          source_message_ids: tool.schema.array(tool.schema.string()).optional().describe("Optional source message IDs."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = args.index_db_path ?? DEFAULT_MEMORY_DB
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const now = Date.now()
            const id = crypto.randomUUID()
            indexDb
              .query(
                "insert into memory_note (id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                id,
                redactSecrets(args.title),
                redactSecrets(args.body),
                args.memory_type,
                JSON.stringify((args.tags ?? []).map(redactSecrets)),
                args.importance ?? 3,
                args.status ?? "active",
                args.scope ?? "project",
                args.source_session_id ?? null,
                JSON.stringify(args.source_message_ids ?? []),
                now,
                now,
              )

            return [
              `stored memory note: ${id}`,
              `title: ${args.title}`,
              `status: ${args.status ?? "active"}`,
              `index_db: ${indexDbPath}`,
            ].join("\n")
          } finally {
            indexDb.close(false)
          }
        },
      }),
      update_trade_memory_note_status: tool({
        description: "Update the status of an existing memory note to active, tentative, or deprecated.",
        args: {
          id: tool.schema.string().min(1).describe("Memory note ID."),
          status: tool.schema.enum(NOTE_STATUSES).describe("New status for the memory note."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = args.index_db_path ?? DEFAULT_MEMORY_DB
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const updatedAt = Date.now()
            const result = indexDb
              .query("update memory_note set status = ?, updated_at = ? where id = ?")
              .run(args.status, updatedAt, args.id)
            if (!result.changes) return `memory note not found: ${args.id}`
            return [`updated memory note: ${args.id}`, `status: ${args.status}`, `index_db: ${indexDbPath}`].join("\n")
          } finally {
            indexDb.close(false)
          }
        },
      }),
      search_trade_memory_notes: tool({
        description:
          "Search curated memory notes by keywords, with recency fallback when the query is empty.",
        args: {
          query: tool.schema.string().optional().describe("FTS query string. Leave empty to list recent notes."),
          limit: tool.schema.number().int().min(1).max(20).optional().describe("Maximum number of notes."),
          index_db_path: tool.schema.string().optional().describe("Optional path to the external memory SQLite database."),
        },
        async execute(args) {
          const indexDbPath = args.index_db_path ?? DEFAULT_MEMORY_DB
          const indexDb = openDatabase(indexDbPath, false)

          try {
            ensureIndexSchema(indexDb)
            const limit = args.limit ?? 8
            const result = args.query?.trim()
              ? runMemorySearch(indexDb, args.query, limit)
              : indexDb
                  .query<MemoryNoteRow, [number]>(
                    "select id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at from memory_note order by updated_at desc limit ?",
                  )
                  .all(limit)
            const rows = Array.isArray(result) ? result : result.rows
            if (!rows.length) {
              if (Array.isArray(result)) return args.query?.trim() ? `no memory note hits for: ${args.query}` : "no memory notes stored"
              return result.warning ? `${result.warning}\nno memory note hits for: ${args.query}` : `no memory note hits for: ${args.query}`
            }
            const body = rows
              .map((row, index) => {
                const tags = decodeStringArray(row.tags).join(", ") || "-"
                const sourceMessageIDs = decodeStringArray(row.source_message_ids).join(", ") || "-"
                return [
                  `${index + 1}. ${row.title}`,
                  `id: ${row.id}`,
                  `type: ${row.memory_type} status: ${row.status} importance: ${row.importance} scope: ${row.scope}`,
                  `tags: ${tags}`,
                  `source_session_id: ${row.source_session_id ?? "-"}`,
                  `source_message_ids: ${sourceMessageIDs}`,
                  `body: ${truncate(row.body, 320)}`,
                ].join("\n")
              })
              .join("\n\n")
            return !Array.isArray(result) && result.warning ? `${result.warning}\n${body}` : body
          } finally {
            indexDb.close(false)
          }
        },
      }),
      render_trade_oracle_note: tool({
        description: "Render the lightweight Decision Note template for a high-risk decision.",
        args: {
          issue: tool.schema.string().min(1).describe("Decision issue to analyze."),
        },
        async execute(args) {
          return [
            "# Decision Note",
            "",
            "## Issue",
            args.issue,
            "",
            "## Context",
            "- Background:",
            "- Constraints:",
            "",
            "## Options",
            "1. ",
            "2. ",
            "",
            "## Recommendation",
            "- Proposed option:",
            "- Why now:",
            "",
            "## Risks",
            "- ",
            "",
            "## Unknowns",
            "- ",
            "",
            "## Rejected Options",
            "- ",
            "",
            "## Human Approval",
            "- Required: yes/no",
            "",
            "## Next Action",
            "- ",
          ].join("\n")
        },
      }),
    },
  }
}) satisfies Plugin

function openDatabase(filename: string, readonly: boolean) {
  const dir = path.dirname(filename)
  if (!readonly) fs.mkdirSync(dir, { recursive: true })
  return new Database(filename, { readonly, create: !readonly })
}

function detectSourceMode(db: Database) {
  if (hasSessionMessageContent(db)) return "session_message" as const
  if (hasLegacyMessagePartContent(db)) return "message_part" as const
  throw new Error("source opencode.db has no supported conversation content in session_message or message/part")
}

function ensureIndexSchema(db: Database) {
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

function upsertMeta(db: Database, key: string, value: string) {
  db.query(
    "insert into schema_meta (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, Date.now())
}

function toConversationRow(row: SourceRow): ConversationRow[] {
  const text = extractRedactedSearchableText(row)
  if (!text) return []
  if (row.type === "user") return [makeConversationRow(row, "user", text)]
  if (row.type === "assistant") return [makeConversationRow(row, "assistant", text)]
  return []
}

function streamConversationRows(
  sourceDb: Database,
  sourceMode: "session_message" | "message_part",
  lastCursor?: { createdAt: number; messageID: string },
) {
  if (sourceMode === "message_part") return streamLegacyConversationRows(sourceDb, lastCursor)
  const rows: ConversationRow[] = []
  const batchSize = 500
  if (!lastCursor) {
    const query = sourceDb.query<SourceRow, [number]>(
      "select id, session_id, seq, type, time_created, data from session_message where type in ('user', 'assistant') order by time_created asc, id asc limit ?",
    )
    let offsetCreatedAt = 0
    let offsetMessageID = ""
    while (true) {
      const batch = offsetMessageID
        ? sourceDb
            .query<SourceRow, [number, number, string, number]>(
              "select id, session_id, seq, type, time_created, data from session_message where type in ('user', 'assistant') and (time_created > ? or (time_created = ? and id > ?)) order by time_created asc, id asc limit ?",
            )
            .all(offsetCreatedAt, offsetCreatedAt, offsetMessageID, batchSize)
        : query.all(batchSize)
      if (!batch.length) return rows
      batch.flatMap(toConversationRow).forEach((row) => rows.push(row))
      const last = batch[batch.length - 1]
      offsetCreatedAt = last.time_created
      offsetMessageID = last.id
    }
  }
  const query = sourceDb.query<SourceRow, [number, number, string, number]>(
    "select id, session_id, seq, type, time_created, data from session_message where type in ('user', 'assistant') and (time_created > ? or (time_created = ? and id > ?)) order by time_created asc, id asc limit ?",
  )
  let createdAt = lastCursor.createdAt
  let messageID = lastCursor.messageID
  while (true) {
    const batch = query.all(createdAt, createdAt, messageID, batchSize)
    if (!batch.length) return rows
    batch.flatMap(toConversationRow).forEach((row) => rows.push(row))
    const last = batch[batch.length - 1]
    createdAt = last.time_created
    messageID = last.id
  }
}

function streamLegacyConversationRows(sourceDb: Database, lastCursor?: { createdAt: number; messageID: string }) {
  const rows: ConversationRow[] = []
  const batchSize = 200
  const query = sourceDb.query<LegacyMessageRow, [number, number, string, number]>(
    "select id, session_id, time_created, data from message where (time_created > ? or (time_created = ? and id > ?)) order by time_created asc, id asc limit ?",
  )
  let createdAt = lastCursor?.createdAt ?? 0
  let messageID = lastCursor?.messageID ?? ""
  while (true) {
    const batch = query.all(createdAt, createdAt, messageID, batchSize)
    if (!batch.length) return rows
    batch.flatMap((row) => toLegacyConversationRow(sourceDb, row)).forEach((row) => rows.push(row))
    const last = batch[batch.length - 1]
    createdAt = last.time_created
    messageID = last.id
  }
}

function extractSearchableText(row: SourceRow) {
  const parsed = decodeJson(row.data)
  if (!parsed || typeof parsed !== "object") return ""
  if (row.type === "user") return normalizeText(fromUserMessage(parsed))
  if (row.type === "assistant") return normalizeText(fromAssistantMessage(parsed))
  return ""
}

function extractRedactedSearchableText(row: SourceRow) {
  const text = extractSearchableText(row)
  if (!text) return ""
  return redactSecrets(text)
}

function toLegacyConversationRow(sourceDb: Database, row: LegacyMessageRow): ConversationRow[] {
  const role = readLegacyRole(row.data)
  if (role !== "user" && role !== "assistant") return []
  const parts = sourceDb
    .query<LegacyPartRow, [string]>(
      "select id, message_id, session_id, time_created, data from part where message_id = ? order by time_created asc, id asc",
    )
    .all(row.id)
  const rawText = parts
    .flatMap((part) => {
      const parsed = decodeJson(part.data)
      if (!parsed || typeof parsed !== "object") return []
      if (!("type" in parsed) || parsed.type !== "text") return []
      if (!("text" in parsed) || typeof parsed.text !== "string") return []
      return [parsed.text]
    })
    .join("\n\n")
  const text = redactSecrets(normalizeText(rawText))
  if (!text) return []
  return [
    {
      messageID: row.id,
      sessionID: row.session_id,
      seq: row.time_created,
      role,
      createdAt: row.time_created,
      text,
      checksum: checksum(`${role}:${text}`),
    },
  ]
}

function readLegacyConversationRow(sourceDb: Database, messageID: string) {
  const row = sourceDb
    .query<LegacyMessageRow, [string]>("select id, session_id, time_created, data from message where id = ? limit 1")
    .get(messageID)
  if (!row) return
  return toLegacyConversationRow(sourceDb, row)[0]
}

function readLegacyRole(input: string) {
  const parsed = decodeJson(input)
  if (!parsed || typeof parsed !== "object") return
  const role = (parsed as LegacyMessageData).role
  return role === "user" || role === "assistant" ? role : undefined
}

function readSessionMessageSource(sourceDb: Database, messageID: string) {
  return sourceDb
    .query<SourceRow, [string]>(
      "select id, session_id, seq, type, time_created, data from session_message where id = ? limit 1",
    )
    .get(messageID)
}

function makeConversationRow(row: SourceRow, role: "user" | "assistant", text: string): ConversationRow {
  return {
    messageID: row.id,
    sessionID: row.session_id,
    seq: row.seq,
    role,
    createdAt: row.time_created,
    text,
    checksum: checksum(`${role}:${text}`),
  }
}

function fromUserMessage(input: object) {
  if (!hasType(input, "user")) return ""
  return typeof (input as SessionMessageUser).text === "string" ? (input as SessionMessageUser).text : ""
}

function fromAssistantMessage(input: object) {
  if (!hasType(input, "assistant")) return ""
  const content = (input as SessionMessageAssistant).content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      if (!("type" in item) || item.type !== "text") return []
      if (!("text" in item) || typeof item.text !== "string") return []
      return [item.text]
    })
    .join("\n\n")
}

function hasType(input: object, expected: string) {
  return "type" in input && input.type === expected
}

function decodeJson(input: string) {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function normalizeText(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function redactSecrets(input: string) {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), input)
}

function checksum(input: string) {
  return Bun.hash(input).toString(16)
}

function resolveSourceDbPath(input: string | undefined) {
  if (!input) return requireExistingSourceDbPath(DEFAULT_OPENCODE_DB_CANDIDATES)
  if (path.isAbsolute(input) || input === ":memory:") return input
  return path.join(DEFAULT_OPENCODE_DATA_DIR, input)
}

function runConversationSearch(db: Database, query: string, limit: number) {
  try {
    return {
      rows: db
      .query<
        {
          message_id: string
          session_id: string
          seq: number
          role: string
          created_at: number
          snippet: string
        },
        [string, number]
      >(
        "select conversation_index.message_id, conversation_index.session_id, conversation_index.seq, conversation_index.role, conversation_index.created_at, snippet(conversation_fts, 0, '[', ']', ' ... ', 18) as snippet from conversation_fts join conversation_index on conversation_fts.rowid = conversation_index.id where conversation_fts match ? and conversation_index.stale = 0 order by bm25(conversation_fts), conversation_index.created_at desc limit ?",
      )
      .all(query, limit),
    } satisfies SearchResult<{
      message_id: string
      session_id: string
      seq: number
      role: string
      created_at: number
      snippet: string
    }>
  } catch {
    return {
      rows: db
      .query<
        {
          message_id: string
          session_id: string
          seq: number
          role: string
          created_at: number
          snippet: string
        },
        [string, number]
      >(
        "select message_id, session_id, seq, role, created_at, substr(text, 1, 280) as snippet from conversation_index where stale = 0 and text like ? order by created_at desc limit ?",
      )
      .all(`%${query}%`, limit),
      warning: SEARCH_WARNING,
    } satisfies SearchResult<{
      message_id: string
      session_id: string
      seq: number
      role: string
      created_at: number
      snippet: string
    }>
  }
}

function runMemorySearch(db: Database, query: string, limit: number) {
  try {
    return {
      rows: db
      .query<MemoryNoteRow, [string, number]>(
        "select memory_note.id, memory_note.title, memory_note.body, memory_note.memory_type, memory_note.tags, memory_note.importance, memory_note.status, memory_note.scope, memory_note.source_session_id, memory_note.source_message_ids, memory_note.created_at, memory_note.updated_at from memory_note_fts join memory_note on memory_note_fts.rowid = memory_note.rowid where memory_note_fts match ? order by bm25(memory_note_fts), memory_note.updated_at desc limit ?",
      )
      .all(query, limit),
    } satisfies SearchResult<MemoryNoteRow>
  } catch {
    return {
      rows: db
      .query<MemoryNoteRow, [string, string, number]>(
        "select id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at from memory_note where title like ? or body like ? order by updated_at desc limit ?",
      )
      .all(`%${query}%`, `%${query}%`, limit),
      warning: SEARCH_WARNING,
    } satisfies SearchResult<MemoryNoteRow>
  }
}

function verifySourceSignature(db: Database) {
  const stored = readMeta(db, "source_signature")
  if (!stored || stored === SOURCE_SIGNATURE_SESSION_MESSAGE || stored === SOURCE_SIGNATURE_MESSAGE_PART) return
  throw new Error(`source signature mismatch: unsupported stored signature ${stored}`)
}

function shouldFullResync(db: Database, sourceDbPath: string) {
  return readMeta(db, "source_db_path") !== sourceDbPath || !readMeta(db, "last_cursor_created_at")
}

function readSyncCursor(db: Database, sourceDbPath: string) {
  if (readMeta(db, "source_db_path") !== sourceDbPath) return
  const createdAt = Number(readMeta(db, "last_cursor_created_at") ?? 0)
  const messageID = readMeta(db, "last_cursor_message_id") ?? ""
  if (!createdAt || !messageID) return
  return { createdAt, messageID }
}

function readMeta(db: Database, key: string) {
  const row = db.query<{ value: string }, [string]>("select value from schema_meta where key = ? limit 1").get(key)
  return row?.value
}

function requireExistingSourceDbPath(candidates: string[]) {
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return found
  throw new Error(`source opencode.db not found. checked: ${candidates.join(", ")}`)
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

function decodeStringArray(input: string) {
  const parsed = decodeJson(input)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is string => typeof item === "string")
}

function truncate(input: string, length: number) {
  if (input.length <= length) return input
  return `${input.slice(0, length - 1)}...`
}
