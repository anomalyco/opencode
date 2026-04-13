import { Database } from "bun:sqlite"

export type RegistryEntry = {
  session_id: string
  status: string
  last_active: number
  current_depth: number
  last_agent: string | null
  is_subsession: number
}

export type MessageRow = {
  id: number
  conversation_id: string
  from_session: string
  to_session: string
  content: string
  timestamp: number
  read: number
  reply_to: number | null
  depth: number
  type: string
  status: string
  retry_count: number
  ttl: number
}

export type MessageInput = Omit<MessageRow, "id">

export type MessageFilter = {
  to_session?: string
  from_session?: string
  conversation_id?: string
  unread_only?: boolean
  type?: string
  status_exclude?: string[]
  limit?: number
}

export type ConversationRow = {
  id: string
  created_at: number
  participants: string
  status: string
  parent_conversation_id: string | null
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    from_session TEXT NOT NULL,
    to_session TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    read INTEGER DEFAULT 0,
    reply_to INTEGER,
    depth INTEGER DEFAULT 0,
    type TEXT DEFAULT 'message',
    status TEXT DEFAULT 'delivered',
    retry_count INTEGER DEFAULT 0,
    ttl INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS registry (
    session_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'available',
    last_active INTEGER NOT NULL,
    current_depth INTEGER DEFAULT 0,
    last_agent TEXT,
    is_subsession INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    participants TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    parent_conversation_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_session, read, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_session, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_ttl ON messages(ttl)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, timestamp)`,
]

export function initDb(path: string): Database {
  const db = new Database(path)
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA read_uncommitted=1")
  for (const sql of SCHEMA) db.exec(sql)
  return db
}

export function getRegistry(db: Database, sessionId: string): RegistryEntry | undefined {
  return db.prepare("SELECT * FROM registry WHERE session_id = ?").get(sessionId) as RegistryEntry | undefined
}

export function upsertRegistry(db: Database, sessionId: string, data: Partial<Omit<RegistryEntry, "session_id">>) {
  const existing = getRegistry(db, sessionId)
  if (existing) {
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(data)) {
      sets.push(`${k} = ?`)
      vals.push(v)
    }
    if (sets.length === 0) return
    db.prepare(`UPDATE registry SET ${sets.join(", ")} WHERE session_id = ?`).run(...vals, sessionId)
  } else {
    const fields = ["session_id", ...Object.keys(data)]
    const placeholders = fields.map(() => "?").join(", ")
    const values = [sessionId, ...Object.values(data)]
    db.prepare(`INSERT INTO registry (${fields.join(", ")}) VALUES (${placeholders})`).run(...values)
  }
}

export function deleteRegistry(db: Database, sessionId: string) {
  db.prepare("DELETE FROM registry WHERE session_id = ?").run(sessionId)
}

export function isSubSession(db: Database, sessionId: string): boolean {
  const row = db.prepare("SELECT is_subsession FROM registry WHERE session_id = ?").get(sessionId) as
    | { is_subsession: number }
    | undefined
  return row?.is_subsession === 1
}

export function updateLastAgent(db: Database, sessionId: string, agentName: string) {
  upsertRegistry(db, sessionId, { last_agent: agentName, last_active: Date.now() })
}

export function syncSubSessionFlags(db: Database, sessions: Array<{ id: string; hasParent: boolean }>) {
  const tx = db.transaction(() => {
    for (const s of sessions) {
      upsertRegistry(db, s.id, { is_subsession: s.hasParent ? 1 : 0, last_active: Date.now() })
    }
  })
  tx()
}

export function insertMessage(db: Database, msg: MessageInput): number {
  const fields = Object.keys(msg) as (keyof MessageInput)[]
  const placeholders = fields.map(() => "?").join(", ")
  const values = fields.map((f) => msg[f])
  const result = db.prepare(`INSERT INTO messages (${fields.join(", ")}) VALUES (${placeholders})`).run(...values)
  return Number(result.lastInsertRowid)
}

export function insertMessages(db: Database, msgs: MessageInput[]) {
  const fields = Object.keys(msgs[0] ?? {}) as (keyof MessageInput)[]
  const placeholders = fields.map(() => "?").join(", ")
  const stmt = db.prepare(`INSERT INTO messages (${fields.join(", ")}) VALUES (${placeholders})`)
  const tx = db.transaction(() => {
    for (const msg of msgs) {
      stmt.run(...fields.map((f) => msg[f]))
    }
  })
  tx()
}

export function getMessages(db: Database, filter: MessageFilter): MessageRow[] {
  const clauses: string[] = []
  const values: unknown[] = []

  if (filter.to_session !== undefined) {
    clauses.push("to_session = ?")
    values.push(filter.to_session)
  }
  if (filter.from_session !== undefined) {
    clauses.push("from_session = ?")
    values.push(filter.from_session)
  }
  if (filter.conversation_id !== undefined) {
    clauses.push("conversation_id = ?")
    values.push(filter.conversation_id)
  }
  if (filter.unread_only) {
    clauses.push("read = 0")
  }
  if (filter.type !== undefined) {
    clauses.push("type = ?")
    values.push(filter.type)
  }
  for (const s of filter.status_exclude ?? []) {
    clauses.push("status != ?")
    values.push(s)
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = filter.limit ? `LIMIT ${filter.limit}` : ""
  const sql = `SELECT * FROM messages ${where} ORDER BY timestamp DESC ${limit}`
  return db.prepare(sql).all(...values) as MessageRow[]
}

export function markRead(db: Database, ids: number[]) {
  if (ids.length === 0) return
  const placeholders = ids.map(() => "?").join(",")
  db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...ids)
}

export function markOrphaned(db: Database, sessionId: string) {
  db.prepare("UPDATE messages SET status = 'orphaned' WHERE to_session = ? OR from_session = ?").run(
    sessionId,
    sessionId,
  )
}

export function getUnreadCount(db: Database, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM messages WHERE to_session = ? AND read = 0 AND status != 'orphaned' AND ttl > ?",
    )
    .get(sessionId, Date.now()) as { count: number }
  return row?.count ?? 0
}

export function getUnreadSummary(
  db: Database,
  sessionId: string,
): Array<{ from_session: string; conversation_id: string; count: number }> {
  return db
    .prepare(
      `SELECT from_session, conversation_id, COUNT(*) as count
     FROM messages
     WHERE to_session = ? AND read = 0 AND status != 'orphaned' AND ttl > ?
     GROUP BY from_session, conversation_id`,
    )
    .all(sessionId, Date.now()) as Array<{ from_session: string; conversation_id: string; count: number }>
}

export function getPendingMessages(db: Database, sessionId: string): MessageRow[] {
  return db.prepare("SELECT * FROM messages WHERE to_session = ? AND status = 'pending'").all(sessionId) as MessageRow[]
}

export function incrementRetryCount(db: Database, messageId: number) {
  db.prepare("UPDATE messages SET retry_count = retry_count + 1 WHERE id = ?").run(messageId)
}

export function getConversation(db: Database, id: string): ConversationRow | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined
}

export function upsertConversation(db: Database, id: string, participants: string[]) {
  const existing = getConversation(db, id)
  const json = JSON.stringify(participants)
  if (existing) {
    db.prepare("UPDATE conversations SET participants = ? WHERE id = ?").run(json, id)
  } else {
    db.prepare("INSERT INTO conversations (id, created_at, participants) VALUES (?, ?, ?)").run(id, Date.now(), json)
  }
}

export function purgeExpired(db: Database): number {
  const result = db.prepare("DELETE FROM messages WHERE ttl < ?").run(Date.now())
  return result.changes
}

export function getBroadcastCount(db: Database, sinceTimestamp: number): number {
  const row = db
    .prepare("SELECT COUNT(DISTINCT conversation_id) as count FROM messages WHERE type = 'broadcast' AND timestamp > ?")
    .get(sinceTimestamp) as { count: number } | undefined
  return row?.count ?? 0
}
