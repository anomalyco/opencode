import { Database } from "bun:sqlite"
import { MemoryNoteRow, SearchResult } from "./types"

const SEARCH_WARNING = "warning: FTS unavailable, using LIKE fallback"

export function runConversationSearch(db: Database, query: string, limit: number) {
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

export function runMemorySearch(db: Database, query: string, limit: number) {
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

export function decodeStringArray(input: string) {
  const parsed = decodeJson(input)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is string => typeof item === "string")
}

export function truncate(input: string, length: number) {
  if (input.length <= length) return input
  return `${input.slice(0, length - 1)}...`
}

function decodeJson(input: string) {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}
