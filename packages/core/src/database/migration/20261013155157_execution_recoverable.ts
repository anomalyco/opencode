import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261013155157_execution_recoverable",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`execution_recoverable\` integer DEFAULT false NOT NULL;`)
    })
  },
}

export default migration
