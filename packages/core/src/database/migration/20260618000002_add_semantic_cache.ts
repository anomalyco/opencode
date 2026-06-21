import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260618000002_add_semantic_cache",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_semantic_cache (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          prompt_embedding TEXT NOT NULL,
          response TEXT NOT NULL,
          metadata TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
