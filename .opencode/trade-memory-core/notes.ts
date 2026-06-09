import { Database } from "bun:sqlite"
import { redactSecrets } from "./redaction"
import { runMemorySearch } from "./search"
import type { MemoryNoteRow, NoteStatus } from "./types"

export type StoreMemoryNoteInput = {
  title: string
  body: string
  memory_type: string
  tags?: string[]
  importance?: number
  status?: NoteStatus
  scope?: string
  source_session_id?: string
  source_message_ids?: string[]
}

export function storeMemoryNote(db: Database, input: StoreMemoryNoteInput) {
  const now = Date.now()
  const id = crypto.randomUUID()
  db.query(
    "insert into memory_note (id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    redactSecrets(input.title),
    redactSecrets(input.body),
    input.memory_type,
    JSON.stringify((input.tags ?? []).map(redactSecrets)),
    input.importance ?? 3,
    input.status ?? "active",
    input.scope ?? "project",
    input.source_session_id ?? null,
    JSON.stringify(input.source_message_ids ?? []),
    now,
    now,
  )
  return { id, status: input.status ?? "active" }
}

export function updateMemoryNoteStatus(db: Database, id: string, status: NoteStatus) {
  return db.query("update memory_note set status = ?, updated_at = ? where id = ?").run(status, Date.now(), id).changes > 0
}

export function searchMemoryNotes(db: Database, query: string | undefined, limit: number) {
  const result = query?.trim()
    ? runMemorySearch(db, query, limit)
    : db
        .query<MemoryNoteRow, [number]>(
          "select id, title, body, memory_type, tags, importance, status, scope, source_session_id, source_message_ids, created_at, updated_at from memory_note order by updated_at desc limit ?",
        )
        .all(limit)
  return { result, rows: Array.isArray(result) ? result : result.rows }
}
