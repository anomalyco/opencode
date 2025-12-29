/**
 * SQLite schema for EventStore
 *
 * Table: events
 * - session_id: session identifier (string)
 * - offset: ULID string (lexicographically sortable)
 * - event_json: JSON-serialized event object
 * - created_at: timestamp (milliseconds since epoch)
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL,
  offset TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, offset)
);

CREATE INDEX IF NOT EXISTS idx_events_session_offset 
  ON events(session_id, offset);
`
