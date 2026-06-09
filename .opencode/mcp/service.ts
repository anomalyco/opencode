import { openDatabase, resolveIndexDbPath } from "../trade-memory-core/db"
import { storeMemoryNote, searchMemoryNotes, updateMemoryNoteStatus, type StoreMemoryNoteInput } from "../trade-memory-core/notes"
import { decodeStringArray, runConversationSearch, truncate } from "../trade-memory-core/search"
import { ensureIndexSchema, readMeta } from "../trade-memory-core/schema"
import { openTradeConversationSource, syncTradeMemoryNow } from "../trade-memory-core/sync"
import type { MemoryNoteRow, NoteStatus } from "../trade-memory-core/types"

const DEFAULT_HANDOFF_MAX_CHARS = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_CHARS ?? 6000)
const DEFAULT_HANDOFF_PIN_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_PINNED_NOTES ?? 12)
const DEFAULT_HANDOFF_NOTE_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_CRITICAL_NOTES ?? 10)
const DEFAULT_HANDOFF_RECENT_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_RECENT_MESSAGES ?? 8)

export function createTradeMemoryService() {
  return {
    health(input?: { indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input?.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const notes = indexDb.query<{ count: number }, []>("select count(*) as count from memory_note").get()?.count ?? 0
        const conversations =
          indexDb.query<{ count: number }, []>("select count(*) as count from conversation_index where stale = 0").get()?.count ?? 0
        return {
          ok: true,
          indexDbPath,
          schemaVersion: readMeta(indexDb, "memory_schema_version") ?? "unknown",
          lastSyncAt: Number(readMeta(indexDb, "last_sync_at") ?? 0) || null,
          noteCount: notes,
          conversationCount: conversations,
        }
      } finally {
        indexDb.close(false)
      }
    },

    sync(input?: { sourceDbPath?: string; indexDbPath?: string; fullResync?: boolean }) {
      return syncTradeMemoryNow(input ?? {})
    },

    searchConversations(input: { query: string; limit?: number; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const result = runConversationSearch(indexDb, input.query, input.limit ?? 8)
        return { indexDbPath, ...result }
      } finally {
        indexDb.close(false)
      }
    },

    openConversationSource(input: { messageID: string; sourceDbPath?: string }) {
      return openTradeConversationSource(input)
    },

    storeNote(input: StoreMemoryNoteInput & { indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        return { indexDbPath, ...storeMemoryNote(indexDb, input) }
      } finally {
        indexDb.close(false)
      }
    },

    updateNoteStatus(input: { id: string; status: NoteStatus; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        return { indexDbPath, updated: updateMemoryNoteStatus(indexDb, input.id, input.status) }
      } finally {
        indexDb.close(false)
      }
    },

    searchNotes(input: { query?: string; limit?: number; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const result = searchMemoryNotes(indexDb, input.query, input.limit ?? 8)
        return { indexDbPath, rows: result.rows, warning: Array.isArray(result.result) ? undefined : result.result.warning }
      } finally {
        indexDb.close(false)
      }
    },

    pinNote(input: { noteID: string; priority?: number; alwaysInclude?: boolean; reason: string; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const note = indexDb.query<{ id: string }, [string]>("select id from memory_note where id = ? limit 1").get(input.noteID)
        if (!note) return { indexDbPath, found: false }
        const now = Date.now()
        const existing = indexDb.query<{ id: string }, [string]>("select id from memory_pin where note_id = ? limit 1").get(input.noteID)
        const id = existing?.id ?? crypto.randomUUID()
        indexDb
          .query(
            "insert into memory_pin (id, note_id, priority, always_include, reason, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set priority = excluded.priority, always_include = excluded.always_include, reason = excluded.reason, updated_at = excluded.updated_at",
          )
          .run(id, input.noteID, input.priority ?? 100, input.alwaysInclude === false ? 0 : 1, input.reason, now, now)
        return { indexDbPath, found: true, id }
      } finally {
        indexDb.close(false)
      }
    },

    unpinNote(input: { id: string; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const removed = indexDb.query("delete from memory_pin where id = ?").run(input.id).changes > 0
        return { indexDbPath, removed }
      } finally {
        indexDb.close(false)
      }
    },

    listPins(input?: { indexDbPath?: string; limit?: number }) {
      const indexDbPath = resolveIndexDbPath(input?.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const rows = indexDb
          .query<
            MemoryNoteRow & { pin_id: string; priority: number; always_include: number; reason: string },
            [number]
          >(
            "select memory_pin.id as pin_id, memory_pin.priority, memory_pin.always_include, memory_pin.reason, memory_note.id, memory_note.title, memory_note.body, memory_note.memory_type, memory_note.tags, memory_note.importance, memory_note.status, memory_note.scope, memory_note.source_session_id, memory_note.source_message_ids, memory_note.created_at, memory_note.updated_at from memory_pin join memory_note on memory_note.id = memory_pin.note_id order by memory_pin.priority desc, memory_pin.updated_at desc limit ?",
          )
          .all(input?.limit ?? 20)
        return { indexDbPath, rows }
      } finally {
        indexDb.close(false)
      }
    },

    markModelSwitched(input: { sessionID: string; providerID?: string; modelID?: string; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const now = Date.now()
        indexDb
          .query(
            "insert into handoff_state (session_id, pending_provider_id, pending_model_id, pending_since, last_event_type, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(session_id) do update set pending_provider_id = excluded.pending_provider_id, pending_model_id = excluded.pending_model_id, pending_since = excluded.pending_since, last_event_type = excluded.last_event_type, updated_at = excluded.updated_at",
          )
          .run(input.sessionID, input.providerID ?? null, input.modelID ?? null, now, "model-switched", now)
        indexDb
          .query(
            "insert into handoff_log (id, session_id, provider_id, model_id, event_type, created_at) values (?, ?, ?, ?, ?, ?)",
          )
          .run(crypto.randomUUID(), input.sessionID, input.providerID ?? null, input.modelID ?? null, "model-switched", now)
        return { indexDbPath, ok: true }
      } finally {
        indexDb.close(false)
      }
    },

    buildHandoffContext(input: { sessionID: string; modelID?: string; maxChars?: number; indexDbPath?: string }) {
      const indexDbPath = resolveIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const lastSyncAt = Number(readMeta(indexDb, "last_sync_at") ?? 0) || null
        const pinned = indexDb
          .query<
            MemoryNoteRow & { pin_id: string; priority: number; always_include: number; reason: string },
            [number]
          >(
            "select memory_pin.id as pin_id, memory_pin.priority, memory_pin.always_include, memory_pin.reason, memory_note.id, memory_note.title, memory_note.body, memory_note.memory_type, memory_note.tags, memory_note.importance, memory_note.status, memory_note.scope, memory_note.source_session_id, memory_note.source_message_ids, memory_note.created_at, memory_note.updated_at from memory_pin join memory_note on memory_note.id = memory_pin.note_id where memory_note.status = 'active' order by memory_pin.priority desc, memory_pin.updated_at desc limit ?",
          )
          .all(DEFAULT_HANDOFF_PIN_LIMIT)
        const recentNotes = indexDb
          .query<MemoryNoteRow, [number]>(
            "select id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at from memory_note where status = 'active' and id not in (select note_id from memory_pin) order by updated_at desc limit ?",
          )
          .all(DEFAULT_HANDOFF_NOTE_LIMIT)
        const recentMessages = indexDb
          .query<{ role: string; text: string; created_at: number }, [string, number]>(
            "select role, text, created_at from conversation_index where stale = 0 and session_id = ? order by created_at desc limit ?",
          )
          .all(input.sessionID, DEFAULT_HANDOFF_RECENT_LIMIT)
          .reverse()
        const warnings = lastSyncAt ? [] : ["- warning: trade memory has not synced yet"]
        const lines = [
          "## Trade Memory Handoff",
          `- session_id: ${input.sessionID}`,
          `- model_id: ${input.modelID ?? "-"}`,
          `- index_db: ${indexDbPath}`,
          `- last_sync_at: ${lastSyncAt ?? "-"}`,
          ...(warnings.length ? ["", "## Warnings", ...warnings] : []),
          "",
          "## Pinned Memory",
          ...formatPinnedNotes(pinned),
          "",
          "## Active Decisions",
          ...formatActiveNotes(recentNotes),
          "",
          "## Recent Conversation",
          ...formatRecentMessages(recentMessages),
        ]
        const block = trimToBudget(lines.join("\n"), input.maxChars ?? DEFAULT_HANDOFF_MAX_CHARS)
        const contentHash = Bun.hash(block).toString(16)
        const now = Date.now()
        indexDb
          .query(
            "update handoff_state set last_model_id = ?, last_injected_at = ?, last_event_type = ?, updated_at = ? where session_id = ?",
          )
          .run(input.modelID ?? null, now, "handoff-context", now, input.sessionID)
        indexDb
          .query(
            "insert into handoff_log (id, session_id, model_id, event_type, content_hash, created_at) values (?, ?, ?, ?, ?, ?)",
          )
          .run(crypto.randomUUID(), input.sessionID, input.modelID ?? null, "handoff-context", contentHash, now)
        return { indexDbPath, block, contentHash, lastSyncAt }
      } finally {
        indexDb.close(false)
      }
    },

    semanticSearch(input: { query: string; limit?: number; indexDbPath?: string }) {
      return {
        indexDbPath: resolveIndexDbPath(input.indexDbPath),
        enabled: false,
        rows: [],
        warning: "semantic search is not enabled; qdrant is optional and not configured",
      }
    },

    renderOracleNote(input: { issue: string }) {
      return [
        "# Decision Note",
        "",
        "## Issue",
        input.issue,
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
  }
}

function formatPinnedNotes(rows: Array<MemoryNoteRow & { priority: number; reason: string }>) {
  if (!rows.length) return ["- none"]
  return rows.flatMap((row, index) => {
    const tags = decodeStringArray(row.tags).join(", ") || "-"
    return [
      `${index + 1}. ${row.title}`,
      `   priority: ${row.priority} reason: ${row.reason}`,
      `   tags: ${tags}`,
      `   body: ${truncate(row.body, 320)}`,
    ]
  })
}

function formatActiveNotes(rows: MemoryNoteRow[]) {
  if (!rows.length) return ["- none"]
  return rows.flatMap((row, index) => {
    const tags = decodeStringArray(row.tags).join(", ") || "-"
    return [
      `${index + 1}. ${row.title}`,
      `   type: ${row.memory_type} importance: ${row.importance} scope: ${row.scope}`,
      `   tags: ${tags}`,
      `   body: ${truncate(row.body, 280)}`,
    ]
  })
}

function formatRecentMessages(rows: Array<{ role: string; text: string; created_at: number }>) {
  if (!rows.length) return ["- none"]
  return rows.map((row, index) => `${index + 1}. [${row.role}] ${truncate(row.text, 220)}`)
}

function trimToBudget(input: string, maxChars: number) {
  if (input.length <= maxChars) return input
  return `${input.slice(0, Math.max(maxChars - 15, 0))}\n[TRUNCATED]`
}

export type TradeMemoryService = ReturnType<typeof createTradeMemoryService>
