import type { Database } from "bun:sqlite"

const currentVersion = 1

export function migrateGatewayStore(database: Database) {
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_schema_version (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version INTEGER NOT NULL
    )
  `)

  const applied = database.query<{ version: number }, []>("SELECT version FROM gateway_schema_version WHERE singleton = 1").get()
  if (applied?.version === currentVersion) return
  if (applied && applied.version > currentVersion) throw new Error("Gateway database schema is newer than this runtime")

  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS gateway_task (
        id TEXT PRIMARY KEY,
        external_message_hash TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prompt_message_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        original_text TEXT NOT NULL,
        reply_target TEXT NOT NULL,
        reply_root_id TEXT,
        state TEXT NOT NULL CHECK (
          state IN ('received', 'admitted', 'running', 'answered', 'sending', 'delivered', 'failed', 'uncertain_delivery')
        ),
        answer TEXT,
        receive_sequence INTEGER NOT NULL UNIQUE,
        send_attempts INTEGER NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS gateway_task_recovery
        ON gateway_task (state, receive_sequence);
      CREATE INDEX IF NOT EXISTS gateway_task_session_order
        ON gateway_task (session_id, receive_sequence);

      CREATE TABLE IF NOT EXISTS gateway_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        parent_event_id TEXT REFERENCES gateway_event(event_id),
        related_event_id TEXT REFERENCES gateway_event(event_id),
        message_id TEXT,
        sentence_id TEXT,
        sentence_index INTEGER,
        actor TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        content_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS gateway_event_trace
        ON gateway_event (trace_id, sequence);
      CREATE INDEX IF NOT EXISTS gateway_event_conversation
        ON gateway_event (conversation_id, sequence);

      CREATE TRIGGER IF NOT EXISTS gateway_event_no_update
      BEFORE UPDATE ON gateway_event
      BEGIN
        SELECT RAISE(ABORT, 'gateway_event is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS gateway_event_no_delete
      BEFORE DELETE ON gateway_event
      BEGIN
        SELECT RAISE(ABORT, 'gateway_event is append-only');
      END;
    `)
    database.run(
      "INSERT INTO gateway_schema_version (singleton, version) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET version = excluded.version",
      [currentVersion],
    )
  }).immediate()
}
