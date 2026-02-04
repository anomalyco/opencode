/**
 * SQLite-based storage layer for OpenCode.
 *
 * This module provides a memory-efficient alternative to file-based storage
 * by using SQLite with FTS5 for full-text search. The key benefits are:
 *
 * 1. Constant memory footprint regardless of data size (configured page cache)
 * 2. Efficient pagination and streaming of large datasets
 * 3. FTS5 full-text search for sessions and messages
 * 4. Instant startup (no re-indexing needed)
 */
import { Database } from "bun:sqlite"
import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { lazy } from "../util/lazy"
import fs from "fs/promises"

export namespace SQLiteStorage {
  const log = Log.create({ service: "sqlite-storage" })

  // Schema version for migrations
  const SCHEMA_VERSION = 1

  // Configure SQLite page cache size (in pages, each page is ~4KB)
  // 5000 pages = ~20MB memory footprint maximum
  const PAGE_CACHE_SIZE = 5000

  interface StorageRecord {
    key: string
    value: string
    created_at: number
    updated_at: number
  }

  const state = lazy(async () => {
    const dir = path.join(Global.Path.data, "storage")
    await fs.mkdir(dir, { recursive: true })

    const dbPath = path.join(dir, "opencode.sqlite")
    const db = new Database(dbPath)

    // Configure SQLite for performance
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -${PAGE_CACHE_SIZE * 4};
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 268435456;
    `)

    // Check and run migrations
    const schemaVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0

    if (schemaVersion < SCHEMA_VERSION) {
      log.info("running migrations", { from: schemaVersion, to: SCHEMA_VERSION })
      runMigrations(db, schemaVersion)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }

    return { db, dir }
  })

  function runMigrations(db: Database, fromVersion: number) {
    if (fromVersion < 1) {
      // Initial schema
      db.exec(`
        -- Main key-value storage table
        CREATE TABLE IF NOT EXISTS storage (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
        );

        -- Index for prefix queries (used by list operations)
        CREATE INDEX IF NOT EXISTS idx_storage_prefix ON storage(key);

        -- Sessions table for optimized queries
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          parent_id TEXT,
          title TEXT NOT NULL,
          directory TEXT NOT NULL,
          version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER,
          data TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

        -- Messages table for optimized queries
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          data TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id DESC);

        -- Parts table for message parts
        CREATE TABLE IF NOT EXISTS parts (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
          data TEXT NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_parts_message ON parts(message_id, id);

        -- FTS5 virtual table for full-text search on sessions
        CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
          id,
          title,
          content='sessions',
          content_rowid='rowid',
          tokenize='trigram'
        );

        -- Triggers to keep FTS index in sync
        CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
          INSERT INTO sessions_fts(rowid, id, title) VALUES (new.rowid, new.id, new.title);
        END;

        CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
          INSERT INTO sessions_fts(sessions_fts, rowid, id, title) VALUES('delete', old.rowid, old.id, old.title);
        END;

        CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
          INSERT INTO sessions_fts(sessions_fts, rowid, id, title) VALUES('delete', old.rowid, old.id, old.title);
          INSERT INTO sessions_fts(rowid, id, title) VALUES (new.rowid, new.id, new.title);
        END;
      `)
    }
  }

  // Prepared statements cache
  let stmtCache: {
    insert?: ReturnType<Database["prepare"]>
    update?: ReturnType<Database["prepare"]>
    select?: ReturnType<Database["prepare"]>
    delete?: ReturnType<Database["prepare"]>
    listKeys?: ReturnType<Database["prepare"]>
    // Session statements
    insertSession?: ReturnType<Database["prepare"]>
    updateSession?: ReturnType<Database["prepare"]>
    selectSession?: ReturnType<Database["prepare"]>
    deleteSession?: ReturnType<Database["prepare"]>
    listSessions?: ReturnType<Database["prepare"]>
    listSessionsPage?: ReturnType<Database["prepare"]>
    countSessions?: ReturnType<Database["prepare"]>
    // Message statements
    insertMessage?: ReturnType<Database["prepare"]>
    updateMessage?: ReturnType<Database["prepare"]>
    selectMessage?: ReturnType<Database["prepare"]>
    deleteMessage?: ReturnType<Database["prepare"]>
    listMessages?: ReturnType<Database["prepare"]>
    listMessagesPage?: ReturnType<Database["prepare"]>
    countMessages?: ReturnType<Database["prepare"]>
    // Part statements
    insertPart?: ReturnType<Database["prepare"]>
    updatePart?: ReturnType<Database["prepare"]>
    selectPart?: ReturnType<Database["prepare"]>
    deletePart?: ReturnType<Database["prepare"]>
    listParts?: ReturnType<Database["prepare"]>
  } = {}

  function getStatements(db: Database) {
    if (!stmtCache.insert) {
      stmtCache = {
        insert: db.prepare(
          "INSERT INTO storage (key, value, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        ),
        update: db.prepare("UPDATE storage SET value = ?, updated_at = ? WHERE key = ?"),
        select: db.prepare("SELECT value FROM storage WHERE key = ?"),
        delete: db.prepare("DELETE FROM storage WHERE key = ?"),
        listKeys: db.prepare("SELECT key FROM storage WHERE key LIKE ? ORDER BY key"),
        // Session statements
        insertSession: db.prepare(`
          INSERT INTO sessions (id, project_id, parent_id, title, directory, version, created_at, updated_at, archived_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            updated_at=excluded.updated_at,
            archived_at=excluded.archived_at,
            data=excluded.data
        `),
        selectSession: db.prepare("SELECT data FROM sessions WHERE id = ?"),
        deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
        listSessions: db.prepare(
          "SELECT id FROM sessions WHERE project_id = ? ORDER BY id DESC",
        ),
        listSessionsPage: db.prepare(
          "SELECT id FROM sessions WHERE project_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
        ),
        countSessions: db.prepare("SELECT COUNT(*) as count FROM sessions WHERE project_id = ?"),
        // Message statements
        insertMessage: db.prepare(`
          INSERT INTO messages (id, session_id, role, created_at, data)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data=excluded.data
        `),
        selectMessage: db.prepare("SELECT data FROM messages WHERE id = ?"),
        deleteMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
        listMessages: db.prepare("SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC"),
        listMessagesPage: db.prepare(
          "SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
        ),
        countMessages: db.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?"),
        // Part statements
        insertPart: db.prepare(`
          INSERT INTO parts (id, message_id, type, data)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data=excluded.data
        `),
        selectPart: db.prepare("SELECT data FROM parts WHERE id = ?"),
        deletePart: db.prepare("DELETE FROM parts WHERE id = ?"),
        listParts: db.prepare("SELECT id FROM parts WHERE message_id = ? ORDER BY id"),
      }
    }
    return stmtCache
  }

  /**
   * Write a value to storage.
   * Memory efficient - only the value being written is in memory.
   */
  export async function write<T>(key: string[], content: T) {
    const { db } = await state()
    const keyStr = key.join("/")
    const value = JSON.stringify(content)
    const now = Date.now()

    const stmts = getStatements(db)
    stmts.insert!.run(keyStr, value, now, now)
  }

  /**
   * Read a value from storage.
   */
  export async function read<T>(key: string[]): Promise<T> {
    const { db } = await state()
    const keyStr = key.join("/")

    const stmts = getStatements(db)
    const result = stmts.select!.get(keyStr) as { value: string } | null

    if (!result) {
      throw new Error(`Resource not found: ${keyStr}`)
    }

    return JSON.parse(result.value) as T
  }

  /**
   * Update a value in storage.
   */
  export async function update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const { db } = await state()
    const keyStr = key.join("/")

    const stmts = getStatements(db)
    const result = stmts.select!.get(keyStr) as { value: string } | null

    if (!result) {
      throw new Error(`Resource not found: ${keyStr}`)
    }

    const content = JSON.parse(result.value) as T
    fn(content)

    const now = Date.now()
    stmts.update!.run(JSON.stringify(content), now, keyStr)

    return content
  }

  /**
   * Remove a value from storage.
   */
  export async function remove(key: string[]) {
    const { db } = await state()
    const keyStr = key.join("/")

    const stmts = getStatements(db)
    stmts.delete!.run(keyStr)
  }

  /**
   * List keys matching a prefix.
   * This is memory efficient - it uses a generator to yield keys one at a time.
   */
  export async function* listKeys(prefix: string[]): AsyncGenerator<string[]> {
    const { db } = await state()
    const prefixStr = prefix.join("/") + "/%"

    const stmts = getStatements(db)
    const results = stmts.listKeys!.all(prefixStr) as { key: string }[]

    for (const row of results) {
      yield row.key.split("/")
    }
  }

  /**
   * List keys matching a prefix and return as array.
   * For compatibility with existing code, but prefer listKeys generator for memory efficiency.
   */
  export async function list(prefix: string[]): Promise<string[][]> {
    const result: string[][] = []
    for await (const key of listKeys(prefix)) {
      result.push(key)
    }
    result.sort()
    return result
  }

  // ============ Session-specific optimized methods ============

  interface SessionData {
    id: string
    projectID: string
    parentID?: string
    title: string
    directory: string
    version: string
    time: {
      created: number
      updated: number
      archived?: number
    }
    [key: string]: unknown
  }

  /**
   * Write a session with optimized indexing.
   */
  export async function writeSession(session: SessionData) {
    const { db } = await state()
    const stmts = getStatements(db)

    stmts.insertSession!.run(
      session.id,
      session.projectID,
      session.parentID ?? null,
      session.title,
      session.directory,
      session.version,
      session.time.created,
      session.time.updated,
      session.time.archived ?? null,
      JSON.stringify(session),
    )
  }

  /**
   * Read a session by ID.
   */
  export async function readSession<T>(sessionId: string): Promise<T> {
    const { db } = await state()
    const stmts = getStatements(db)

    const result = stmts.selectSession!.get(sessionId) as { data: string } | null
    if (!result) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return JSON.parse(result.data) as T
  }

  /**
   * Delete a session by ID.
   */
  export async function deleteSession(sessionId: string) {
    const { db } = await state()
    const stmts = getStatements(db)
    stmts.deleteSession!.run(sessionId)
  }

  /**
   * List session IDs for a project with pagination.
   * Memory efficient - returns only IDs, not full session data.
   */
  export async function* listSessionIds(projectId: string): AsyncGenerator<string> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listSessions!.all(projectId) as { id: string }[]
    for (const row of results) {
      yield row.id
    }
  }

  /**
   * List sessions with pagination for memory efficiency.
   */
  export async function listSessionsPage<T>(
    projectId: string,
    options: { limit: number; offset: number },
  ): Promise<T[]> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listSessionsPage!.all(projectId, options.limit, options.offset) as { id: string }[]
    const sessions: T[] = []

    for (const row of results) {
      const data = stmts.selectSession!.get(row.id) as { data: string } | null
      if (data) {
        sessions.push(JSON.parse(data.data) as T)
      }
    }

    return sessions
  }

  /**
   * Count sessions for a project.
   */
  export async function countSessions(projectId: string): Promise<number> {
    const { db } = await state()
    const stmts = getStatements(db)
    const result = stmts.countSessions!.get(projectId) as { count: number }
    return result.count
  }

  // ============ Message-specific optimized methods ============

  interface MessageData {
    id: string
    sessionID: string
    role: string
    time: {
      created: number
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  /**
   * Write a message with optimized indexing.
   */
  export async function writeMessage(message: MessageData) {
    const { db } = await state()
    const stmts = getStatements(db)

    stmts.insertMessage!.run(
      message.id,
      message.sessionID,
      message.role,
      message.time.created,
      JSON.stringify(message),
    )
  }

  /**
   * Read a message by ID.
   */
  export async function readMessage<T>(messageId: string): Promise<T> {
    const { db } = await state()
    const stmts = getStatements(db)

    const result = stmts.selectMessage!.get(messageId) as { data: string } | null
    if (!result) {
      throw new Error(`Message not found: ${messageId}`)
    }

    return JSON.parse(result.data) as T
  }

  /**
   * Delete a message by ID.
   */
  export async function deleteMessage(messageId: string) {
    const { db } = await state()
    const stmts = getStatements(db)
    stmts.deleteMessage!.run(messageId)
  }

  /**
   * List message IDs for a session.
   * Memory efficient - yields IDs one at a time in descending order.
   */
  export async function* listMessageIds(sessionId: string): AsyncGenerator<string> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listMessages!.all(sessionId) as { id: string }[]
    for (const row of results) {
      yield row.id
    }
  }

  /**
   * List messages with pagination.
   */
  export async function listMessagesPage<T>(
    sessionId: string,
    options: { limit: number; offset: number },
  ): Promise<T[]> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listMessagesPage!.all(sessionId, options.limit, options.offset) as { id: string }[]
    const messages: T[] = []

    for (const row of results) {
      const data = stmts.selectMessage!.get(row.id) as { data: string } | null
      if (data) {
        messages.push(JSON.parse(data.data) as T)
      }
    }

    return messages
  }

  /**
   * Count messages for a session.
   */
  export async function countMessages(sessionId: string): Promise<number> {
    const { db } = await state()
    const stmts = getStatements(db)
    const result = stmts.countMessages!.get(sessionId) as { count: number }
    return result.count
  }

  // ============ Part-specific optimized methods ============

  interface PartData {
    id: string
    messageID: string
    type: string
    [key: string]: unknown
  }

  /**
   * Write a message part.
   */
  export async function writePart(part: PartData) {
    const { db } = await state()
    const stmts = getStatements(db)

    stmts.insertPart!.run(part.id, part.messageID, part.type, JSON.stringify(part))
  }

  /**
   * Read a part by ID.
   */
  export async function readPart<T>(partId: string): Promise<T> {
    const { db } = await state()
    const stmts = getStatements(db)

    const result = stmts.selectPart!.get(partId) as { data: string } | null
    if (!result) {
      throw new Error(`Part not found: ${partId}`)
    }

    return JSON.parse(result.data) as T
  }

  /**
   * Delete a part by ID.
   */
  export async function deletePart(partId: string) {
    const { db } = await state()
    const stmts = getStatements(db)
    stmts.deletePart!.run(partId)
  }

  /**
   * List part IDs for a message.
   */
  export async function* listPartIds(messageId: string): AsyncGenerator<string> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listParts!.all(messageId) as { id: string }[]
    for (const row of results) {
      yield row.id
    }
  }

  /**
   * List all parts for a message.
   */
  export async function listParts<T>(messageId: string): Promise<T[]> {
    const { db } = await state()
    const stmts = getStatements(db)

    const results = stmts.listParts!.all(messageId) as { id: string }[]
    const parts: T[] = []

    for (const row of results) {
      const data = stmts.selectPart!.get(row.id) as { data: string } | null
      if (data) {
        parts.push(JSON.parse(data.data) as T)
      }
    }

    return parts
  }

  // ============ Full-text search ============

  /**
   * Search sessions by title using FTS5.
   */
  export async function searchSessions(query: string, limit = 20): Promise<string[]> {
    const { db } = await state()

    // Escape special FTS5 characters and create a prefix search
    const escapedQuery = query.replace(/['"]/g, '""')
    const stmt = db.prepare(`
      SELECT id FROM sessions_fts
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)

    const results = stmt.all(`"${escapedQuery}"*`, limit) as { id: string }[]
    return results.map((r) => r.id)
  }

  // ============ Migration utilities ============

  /**
   * Check if SQLite storage has been initialized.
   */
  export async function isInitialized(): Promise<boolean> {
    const { db } = await state()
    try {
      const result = db.query("SELECT COUNT(*) as count FROM storage").get() as { count: number }
      return result.count > 0 || true // Table exists = initialized
    } catch {
      return false
    }
  }

  /**
   * Get the underlying database for advanced operations.
   */
  export async function getDatabase(): Promise<Database> {
    const { db } = await state()
    return db
  }

  /**
   * Close the database connection.
   */
  export async function close() {
    const { db } = await state()
    db.close()
    stmtCache = {}
  }
}
