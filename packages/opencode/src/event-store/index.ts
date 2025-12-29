import { Database } from "bun:sqlite"
import { monotonicFactory } from "ulid"
import { SCHEMA } from "./schema"

/**
 * EventStore provides SQLite-backed event persistence with ULID offsets.
 *
 * Features:
 * - append(sessionId, event): Store event and return ULID offset
 * - query(sessionId, fromOffset): Retrieve events from offset onwards (catch-up)
 * - getLatestOffset(sessionId): Get most recent offset for session
 *
 * Offsets are ULIDs (lexicographically sortable, monotonically increasing).
 * Special offset "-1" represents stream start (returns all events).
 */
export class EventStore {
  private ulid = monotonicFactory()
  private stmts: {
    insert: ReturnType<Database["prepare"]>
    queryAll: ReturnType<Database["prepare"]>
    queryFrom: ReturnType<Database["prepare"]>
    latest: ReturnType<Database["prepare"]>
  }

  private constructor(private db: Database) {
    this.stmts = {
      insert: db.prepare("INSERT INTO events (session_id, offset, event_json, created_at) VALUES (?, ?, ?, ?)"),
      queryAll: db.prepare("SELECT offset, event_json FROM events WHERE session_id = ? ORDER BY offset ASC"),
      queryFrom: db.prepare(
        "SELECT offset, event_json FROM events WHERE session_id = ? AND offset >= ? ORDER BY offset ASC",
      ),
      latest: db.prepare("SELECT offset FROM events WHERE session_id = ? ORDER BY offset DESC LIMIT 1"),
    }
  }

  /**
   * Create EventStore instance with SQLite database.
   *
   * @param path - Database file path or ":memory:" for in-memory
   */
  static create(path: string): EventStore {
    const db = new Database(path)
    db.exec(SCHEMA)
    return new EventStore(db)
  }

  /**
   * Append event to session's stream.
   *
   * @param sessionId - Session identifier
   * @param event - Event object to store
   * @returns ULID offset for the appended event
   */
  append(sessionId: string, event: unknown): string {
    const offset = this.ulid()
    const eventJson = JSON.stringify(event)
    const createdAt = Date.now()

    this.stmts.insert.run(sessionId, offset, eventJson, createdAt)

    return offset
  }

  /**
   * Query events from offset onwards (catch-up semantics).
   *
   * @param sessionId - Session identifier
   * @param fromOffset - Starting offset ("-1" for stream start, or ULID)
   * @returns Array of events with offsets, lexicographically ordered
   */
  query(sessionId: string, fromOffset: string): Array<{ offset: string; event: unknown }> {
    const rows =
      fromOffset === "-1" ? this.stmts.queryAll.all(sessionId) : this.stmts.queryFrom.all(sessionId, fromOffset)

    return rows.map((row: any) => ({
      offset: row.offset,
      event: JSON.parse(row.event_json),
    }))
  }

  /**
   * Get latest offset for a session.
   *
   * @param sessionId - Session identifier
   * @returns Latest ULID offset or null if no events
   */
  getLatestOffset(sessionId: string): string | null {
    const row = this.stmts.latest.get(sessionId) as { offset: string } | undefined
    return row?.offset ?? null
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close()
  }
}
