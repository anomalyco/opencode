export const NOTE_STATUSES = ["active", "tentative", "deprecated"] as const

export type NoteStatus = (typeof NOTE_STATUSES)[number]

export type SourceMode = "session_message" | "message_part"

export type SourceRow = {
  id: string
  session_id: string
  seq: number
  type: string
  time_created: number
  data: string
}

export type LegacyMessageRow = {
  id: string
  session_id: string
  time_created: number
  data: string
}

export type LegacyPartRow = {
  id: string
  message_id: string
  session_id: string
  time_created: number
  data: string
}

export type ConversationRow = {
  messageID: string
  sessionID: string
  seq: number
  role: "user" | "assistant"
  createdAt: number
  text: string
  checksum: string
}

export type MemoryNoteRow = {
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

export type SearchResult<Row> = {
  rows: Row[]
  warning?: string
}

export type SyncReport = {
  syncRunID: string
  count: number
  fullResync: boolean
  sourceDbPath: string
  indexDbPath: string
  sourceMode: SourceMode
}

export type SessionMessageUser = {
  type: "user"
  text?: unknown
}

export type SessionMessageAssistant = {
  type: "assistant"
  content?: unknown
}

export type LegacyMessageData = {
  role?: unknown
}

export type TradeConversationSource = {
  role: "user" | "assistant"
  sessionID: string
  messageID: string
  seq: number
  createdAt: number
  text: string
}
