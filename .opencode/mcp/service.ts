import { openDatabase, resolveIndexDbPath } from "../trade-memory-core/db"
import { searchMemoryNotes, storeMemoryNote, updateMemoryNoteStatus, type StoreMemoryNoteInput } from "../trade-memory-core/notes"
import { decodeStringArray, runConversationSearch, truncate } from "../trade-memory-core/search"
import { ensureIndexSchema, readMeta } from "../trade-memory-core/schema"
import { openTradeConversationSource, syncTradeMemoryNow } from "../trade-memory-core/sync"
import type { MemoryNoteRow, NoteStatus } from "../trade-memory-core/types"

const DEFAULT_HANDOFF_MAX_CHARS = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_CHARS ?? 6000)
const DEFAULT_HANDOFF_PIN_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_PINNED_NOTES ?? 12)
const DEFAULT_HANDOFF_NOTE_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_MAX_CRITICAL_NOTES ?? 10)
const DEFAULT_HANDOFF_RECENT_LIMIT = Number(process.env.OPENCODE_TRADE_HANDOFF_RECENT_MESSAGES ?? 8)
const MAX_LIST_LIMIT = 50
const NOTE_STATUSES = new Set<NoteStatus>(["active", "tentative", "deprecated"])

export class TradeMemoryInputError extends Error {}

export function createTradeMemoryService(defaults?: { indexDbPath?: string; sourceDbPath?: string }) {
  const resolveServiceIndexDbPath = (input?: string) => resolveIndexDbPath(input ?? defaults?.indexDbPath)
  const resolveServiceSourceDbPath = (input?: string) => input ?? defaults?.sourceDbPath

  return {
    health(input?: { indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input?.indexDbPath)
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
      return syncTradeMemoryNow({
        sourceDbPath: resolveServiceSourceDbPath(input?.sourceDbPath),
        indexDbPath: resolveServiceIndexDbPath(input?.indexDbPath),
        fullResync: input?.fullResync,
      })
    },

    searchConversations(input: { query: string; limit?: number; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const result = runConversationSearch(indexDb, requireNonEmpty(input.query, "query"), clampLimit(input.limit, 8, 20))
        return { indexDbPath, ...result }
      } finally {
        indexDb.close(false)
      }
    },

    openConversationSource(input: { messageID: string; sourceDbPath?: string }) {
      return openTradeConversationSource({
        messageID: requireNonEmpty(input.messageID, "messageID"),
        sourceDbPath: resolveServiceSourceDbPath(input.sourceDbPath),
      })
    },

    storeNote(input: StoreMemoryNoteInput & { indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        return {
          indexDbPath,
          ...storeMemoryNote(indexDb, {
            ...input,
            title: requireNonEmpty(input.title, "title"),
            body: requireNonEmpty(input.body, "body"),
            memory_type: requireNonEmpty(input.memory_type, "memory_type"),
          }),
        }
      } finally {
        indexDb.close(false)
      }
    },

    updateNoteStatus(input: { id: string; status: NoteStatus; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        return {
          indexDbPath,
          updated: updateMemoryNoteStatus(indexDb, requireNonEmpty(input.id, "id"), requireStatus(input.status)),
        }
      } finally {
        indexDb.close(false)
      }
    },

    searchNotes(input: { query?: string; limit?: number; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const result = searchMemoryNotes(indexDb, normalizeOptionalString(input.query), clampLimit(input.limit, 8, 20))
        return { indexDbPath, rows: result.rows, warning: Array.isArray(result.result) ? undefined : result.result.warning }
      } finally {
        indexDb.close(false)
      }
    },

    pinNote(input: { noteID: string; priority?: number; alwaysInclude?: boolean; reason: string; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const noteID = requireNonEmpty(input.noteID, "noteID")
        const note = indexDb.query<{ id: string }, [string]>("select id from memory_note where id = ? limit 1").get(noteID)
        if (!note) return { indexDbPath, found: false }
        const now = Date.now()
        const existing = indexDb.query<{ id: string }, [string]>("select id from memory_pin where note_id = ? limit 1").get(noteID)
        const id = existing?.id ?? crypto.randomUUID()
        indexDb
          .query(
            "insert into memory_pin (id, note_id, priority, always_include, reason, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set priority = excluded.priority, always_include = excluded.always_include, reason = excluded.reason, updated_at = excluded.updated_at",
          )
          .run(id, noteID, input.priority ?? 100, input.alwaysInclude === false ? 0 : 1, requireNonEmpty(input.reason, "reason"), now, now)
        return { indexDbPath, found: true, id }
      } finally {
        indexDb.close(false)
      }
    },

    unpinNote(input: { id: string; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const removed = indexDb.query("delete from memory_pin where id = ?").run(requireNonEmpty(input.id, "id")).changes > 0
        return { indexDbPath, removed }
      } finally {
        indexDb.close(false)
      }
    },

    listPins(input?: { indexDbPath?: string; limit?: number }) {
      const indexDbPath = resolveServiceIndexDbPath(input?.indexDbPath)
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
          .all(clampLimit(input?.limit, 20, MAX_LIST_LIMIT))
        return { indexDbPath, rows }
      } finally {
        indexDb.close(false)
      }
    },

    markModelSwitched(input: { sessionID: string; providerID?: string; modelID?: string; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const sessionID = requireNonEmpty(input.sessionID, "sessionID")
        const now = Date.now()
        indexDb
          .query(
            "insert into handoff_state (session_id, pending_provider_id, pending_model_id, pending_since, last_event_type, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(session_id) do update set pending_provider_id = excluded.pending_provider_id, pending_model_id = excluded.pending_model_id, pending_since = excluded.pending_since, last_event_type = excluded.last_event_type, updated_at = excluded.updated_at",
          )
          .run(sessionID, normalizeOptionalString(input.providerID) ?? null, normalizeOptionalString(input.modelID) ?? null, now, "model-switched", now)
        indexDb
          .query(
            "insert into handoff_log (id, session_id, provider_id, model_id, event_type, created_at) values (?, ?, ?, ?, ?, ?)",
          )
          .run(crypto.randomUUID(), sessionID, normalizeOptionalString(input.providerID) ?? null, normalizeOptionalString(input.modelID) ?? null, "model-switched", now)
        return { indexDbPath, ok: true }
      } finally {
        indexDb.close(false)
      }
    },

    buildHandoffContext(input: { sessionID: string; modelID?: string; maxChars?: number; indexDbPath?: string }) {
      const indexDbPath = resolveServiceIndexDbPath(input.indexDbPath)
      const indexDb = openDatabase(indexDbPath, false)

      try {
        ensureIndexSchema(indexDb)
        const sessionID = requireNonEmpty(input.sessionID, "sessionID")
        const modelID = normalizeOptionalString(input.modelID)
        const maxChars = clampPositive(input.maxChars, DEFAULT_HANDOFF_MAX_CHARS)
        const lastSyncAt = Number(readMeta(indexDb, "last_sync_at") ?? 0) || null
        const handoffState = indexDb
          .query<{ pending_since: number | null }, [string]>("select pending_since from handoff_state where session_id = ? limit 1")
          .get(sessionID)
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
            "select id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at from memory_note where status = 'active' and id not in (select note_id from memory_pin) order by case when importance >= 4 then 0 when memory_type in ('decision', 'risk', 'unresolved', 'rejection', 'handoff') then 1 else 2 end, importance desc, updated_at desc limit ?",
          )
          .all(DEFAULT_HANDOFF_NOTE_LIMIT)
        const recentMessages = indexDb
          .query<{ role: string; text: string; created_at: number }, [string, number]>(
            "select role, text, created_at from conversation_index where stale = 0 and session_id = ? order by created_at desc limit ?",
          )
          .all(sessionID, DEFAULT_HANDOFF_RECENT_LIMIT)
          .reverse()
        const warnings = lastSyncAt ? [] : ["- warning: trade memory has not synced yet"]
        if (handoffState?.pending_since && (!lastSyncAt || handoffState.pending_since > lastSyncAt)) {
          warnings.push("- warning: trade memory may be stale for the latest model switch")
        }
        const lines = buildHandoffLines({
          sessionID,
          modelID: modelID ?? "-",
          indexDbPath,
          lastSyncAt,
          warnings,
          pinned: formatPinnedNotes(pinned),
          active: formatActiveNotes(recentNotes),
          recent: formatRecentMessages(recentMessages),
          maxChars,
        })
        const block = lines.join("\n")
        const contentHash = Bun.hash(block).toString(16)
        const now = Date.now()
        indexDb
          .query(
            "insert into handoff_state (session_id, last_model_id, pending_provider_id, pending_model_id, pending_since, last_injected_at, last_event_type, updated_at) values (?, ?, null, null, null, ?, ?, ?) on conflict(session_id) do update set last_model_id = excluded.last_model_id, pending_provider_id = null, pending_model_id = null, pending_since = null, last_injected_at = excluded.last_injected_at, last_event_type = excluded.last_event_type, updated_at = excluded.updated_at",
          )
          .run(sessionID, modelID ?? null, now, "handoff-context", now)
        indexDb
          .query(
            "insert into handoff_log (id, session_id, model_id, event_type, content_hash, created_at) values (?, ?, ?, ?, ?, ?)",
          )
          .run(crypto.randomUUID(), sessionID, modelID ?? null, "handoff-context", contentHash, now)
        return { indexDbPath, block, contentHash, lastSyncAt }
      } finally {
        indexDb.close(false)
      }
    },

    semanticSearch(input: { query: string; limit?: number; indexDbPath?: string }) {
      return {
        indexDbPath: resolveServiceIndexDbPath(input.indexDbPath),
        enabled: false,
        rows: [],
        warning: requireNonEmpty(input.query, "query") && "semantic search is not enabled; qdrant is optional and not configured",
      }
    },

    renderOracleNote(input: { issue: string }) {
      return [
        "# Decision Note",
        "",
        "## Issue",
        requireNonEmpty(input.issue, "issue"),
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

function buildHandoffLines(input: {
  sessionID: string
  modelID: string
  indexDbPath: string
  lastSyncAt: number | null
  warnings: string[]
  pinned: string[]
  active: string[]
  recent: string[]
  maxChars: number
}) {
  const sections = [
    { heading: "## Pinned Memory", lines: input.pinned },
    { heading: "## Active Decisions", lines: input.active },
    { heading: "## Recent Conversation", lines: input.recent },
  ]
  const lines = [
    "## Trade Memory Handoff",
    `- session_id: ${input.sessionID}`,
    `- model_id: ${input.modelID}`,
    `- index_db: ${input.indexDbPath}`,
    `- last_sync_at: ${input.lastSyncAt ?? "-"}`,
    ...(input.warnings.length ? ["", "## Warnings", ...input.warnings] : []),
  ]
  sections.forEach((section, index) => appendSection(lines, section.heading, section.lines, input.maxChars, sections.slice(index + 1)))
  return lines
}

function appendSection(
  output: string[],
  heading: string,
  lines: string[],
  maxChars: number,
  remaining: Array<{ heading: string; lines: string[] }>,
) {
  output.push("", heading)
  const sectionLines = lines.length ? lines : ["- none"]
  let wrote = false
  for (const line of sectionLines) {
    const reserve = remaining.reduce((total, section) => total + lineLength(["", section.heading, "- none"]), 0)
    if (lineLength([...output, line]) + reserve <= maxChars) {
      output.push(line)
      wrote = true
      continue
    }
    const truncated = wrote ? "[TRUNCATED]" : "- truncated"
    if (lineLength([...output, truncated]) + reserve <= maxChars) output.push(truncated)
    return
  }
}

function lineLength(lines: string[]) {
  return lines.join("\n").length
}

function requireNonEmpty(input: string, field: string) {
  const value = input.trim()
  if (!value) throw new TradeMemoryInputError(`${field} must not be empty`)
  return value
}

function normalizeOptionalString(input: string | undefined) {
  const value = input?.trim()
  return value ? value : undefined
}

function requireStatus(input: NoteStatus) {
  if (!NOTE_STATUSES.has(input)) throw new TradeMemoryInputError("status is invalid")
  return input
}

function clampLimit(input: number | undefined, fallback: number, max: number) {
  if (input === undefined) return fallback
  if (!Number.isFinite(input) || input < 1) throw new TradeMemoryInputError("limit must be a positive integer")
  return Math.min(Math.floor(input), max)
}

function clampPositive(input: number | undefined, fallback: number) {
  if (input === undefined) return fallback
  if (!Number.isFinite(input) || input < 1) throw new TradeMemoryInputError("maxChars must be a positive integer")
  return Math.floor(input)
}

function formatPinnedNotes(rows: Array<MemoryNoteRow & { priority: number; reason: string }>) {
  if (!rows.length) return ["- none"]
  return rows.flatMap((row, index) => {
    const tags = decodeStringArray(row.tags).join(", ") || "-"
    return [
      `${index + 1}. ${row.title}`,
      `   priority: ${row.priority} reason: ${row.reason}`,
      `   tags: ${tags}`,
      `   body: ${truncate(row.body, 240)}`,
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
      `   body: ${truncate(row.body, 200)}`,
    ]
  })
}

function formatRecentMessages(rows: Array<{ role: string; text: string; created_at: number }>) {
  if (!rows.length) return ["- none"]
  return rows.map((row, index) => `${index + 1}. [${row.role}] ${truncate(row.text, 160)}`)
}

export type TradeMemoryService = ReturnType<typeof createTradeMemoryService>
