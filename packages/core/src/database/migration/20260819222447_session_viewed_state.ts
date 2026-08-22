import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260819222447_session_viewed_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`time_idle\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`time_viewed\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`idle_outcome\` text;`)
    })
  },
}

export default migration
