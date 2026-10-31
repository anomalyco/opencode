import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261031220211_schedule_background_actions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`active_job_id\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`dedicated_session_id\` text;`)
    })
  },
}

export default migration
