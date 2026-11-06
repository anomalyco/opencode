import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261106230500_drop_schedule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`schedule_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`schedule_due_idx\`;`)
      yield* tx.run(`DROP TABLE \`schedule\`;`)
    })
  },
}

export default migration
