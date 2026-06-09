import { Database } from "bun:sqlite"
import { openDatabase, resolveIndexDbPath, resolveSourceDbPath } from "./db"
import { redactSecrets } from "./redaction"
import { detectSourceMode, ensureIndexSchema, readSyncCursor, shouldFullResync, SourceSignature, upsertMeta } from "./schema"
import {
  ConversationRow,
  LegacyMessageRow,
  LegacyPartRow,
  SourceMode,
  SourceRow,
  SyncReport,
  TradeConversationSource,
} from "./types"

export function syncTradeMemoryNow(args: { sourceDbPath?: string; indexDbPath?: string; fullResync?: boolean }): SyncReport {
  const sourceDbPath = resolveSourceDbPath(args.sourceDbPath ?? process.env.OPENCODE_DB)
  const indexDbPath = resolveIndexDbPath(args.indexDbPath)
  const syncRunID = crypto.randomUUID()
  const startedAt = Date.now()
  let sourceDb
  let indexDb

  try {
    sourceDb = openDatabase(sourceDbPath, true)
    indexDb = openDatabase(indexDbPath, false)
    const sourceMode = detectSourceMode(sourceDb)
    ensureIndexSchema(indexDb)
    const syncedAt = Date.now()
    const fullResync = args.fullResync ?? shouldFullResync(indexDb, sourceDbPath)
    indexDb
      .query(
        "insert into sync_run (id, started_at, source_db_path, index_db_path, mode, source_mode, count) values (?, ?, ?, ?, ?, ?, 0)",
      )
      .run(syncRunID, startedAt, sourceDbPath, indexDbPath, fullResync ? "full" : "incremental", sourceMode)
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
      upsertMeta(indexDb, "source_signature", sourceMode === "session_message" ? SourceSignature.sessionMessage : SourceSignature.messagePart)
      upsertMeta(indexDb, "last_sync_at", String(syncedAt))
      upsertMeta(indexDb, "source_db_path", sourceDbPath)
      upsertMeta(indexDb, "source_mode", sourceMode)
      upsertMeta(indexDb, "last_sync_mode", fullResync ? "full" : "incremental")
      if (count.value) {
        upsertMeta(indexDb, "last_cursor_created_at", String(cursor.createdAt))
        upsertMeta(indexDb, "last_cursor_message_id", cursor.messageID)
      }
      indexDb.query("update sync_run set finished_at = ?, count = ? where id = ?").run(Date.now(), count.value, syncRunID)
    })()

    return {
      syncRunID,
      count: count.value,
      fullResync,
      sourceDbPath,
      indexDbPath,
      sourceMode,
    }
  } catch (error) {
    if (indexDb) {
      try {
        ensureIndexSchema(indexDb)
        indexDb
          .query(
            "insert into sync_run (id, started_at, finished_at, source_db_path, index_db_path, mode, count, error) values (?, ?, ?, ?, ?, ?, 0, ?) on conflict(id) do update set finished_at = excluded.finished_at, error = excluded.error",
          )
          .run(
            syncRunID,
            startedAt,
            Date.now(),
            sourceDbPath,
            indexDbPath,
            args.fullResync ? "full" : "incremental",
            error instanceof Error ? error.message : String(error),
          )
      } catch {
      }
    }
    throw error
  } finally {
    sourceDb?.close(false)
    indexDb?.close(false)
  }
}

export function openTradeConversationSource(args: { sourceDbPath?: string; messageID: string }) {
  const sourceDbPath = resolveSourceDbPath(args.sourceDbPath ?? process.env.OPENCODE_DB)
  let sourceDb

  try {
    sourceDb = openDatabase(sourceDbPath, true)
    const sourceMode = detectSourceMode(sourceDb)
    if (sourceMode === "session_message") {
      const row = readSessionMessageSource(sourceDb, args.messageID)
      if (!row) return { kind: "not-found" as const, sourceDbPath }
      const text = extractRedactedSearchableText(row)
      if (!text) return { kind: "not-indexed" as const, sourceDbPath }
      return {
        kind: "found" as const,
        sourceDbPath,
        source: {
          role: row.type,
          sessionID: row.session_id,
          messageID: row.id,
          seq: row.seq,
          createdAt: row.time_created,
          text,
        } satisfies TradeConversationSource,
      }
    }
    const legacy = readLegacyConversationRow(sourceDb, args.messageID)
    if (!legacy) return { kind: "not-found" as const, sourceDbPath }
    return {
      kind: "found" as const,
      sourceDbPath,
      source: {
        role: legacy.role,
        sessionID: legacy.sessionID,
        messageID: legacy.messageID,
        seq: legacy.seq,
        createdAt: legacy.createdAt,
        text: legacy.text,
      } satisfies TradeConversationSource,
    }
  } finally {
    sourceDb?.close(false)
  }
}

function toConversationRow(row: SourceRow): ConversationRow[] {
  const text = extractRedactedSearchableText(row)
  if (!text) return []
  if (row.type === "user") return [makeConversationRow(row, "user", text)]
  if (row.type === "assistant") return [makeConversationRow(row, "assistant", text)]
  return []
}

function streamConversationRows(sourceDb: Database, sourceMode: SourceMode, lastCursor?: { createdAt: number; messageID: string }) {
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

function readLegacyConversationRow(sourceDb: Database, messageID: string): ConversationRow | undefined {
  const row = sourceDb
    .query<LegacyMessageRow, [string]>("select id, session_id, time_created, data from message where id = ? limit 1")
    .get(messageID)
  if (!row) return undefined
  return toLegacyConversationRow(sourceDb, row)[0]
}

function readLegacyRole(input: string): ConversationRow["role"] | undefined {
  const parsed = decodeJson(input)
  if (!parsed || typeof parsed !== "object") return undefined
  const role = "role" in parsed ? parsed.role : undefined
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
  return "text" in input && typeof input.text === "string" ? input.text : ""
}

function fromAssistantMessage(input: object) {
  if (!hasType(input, "assistant")) return ""
  const content = "content" in input ? input.content : undefined
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

function checksum(input: string) {
  return Bun.hash(input).toString(16)
}
