import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261025154125_drop_session_pending",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_pending_session_delivery_seq_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_pending_session_compaction_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_pending_session_admitted_seq_idx\`;`)
      yield* tx.run(`DROP TABLE IF EXISTS \`session_pending\`;`)
    })
  },
}

export default migration
