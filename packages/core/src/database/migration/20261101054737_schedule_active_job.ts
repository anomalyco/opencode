import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261101054737_schedule_active_job",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`active_job_id\` text;`)
    })
  },
}

export default migration
