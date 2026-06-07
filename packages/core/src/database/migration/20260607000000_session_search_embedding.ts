import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260607000000_session_search_embedding",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS session_search_embedding (
          fingerprint TEXT PRIMARY KEY,
          vector BLOB NOT NULL,
          dimensions INTEGER NOT NULL,
          model TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_accessed_at INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE INDEX IF NOT EXISTS idx_embedding_lru
          ON session_search_embedding(model, last_accessed_at);
      `)
    })
  },
} satisfies DatabaseMigration.Migration
