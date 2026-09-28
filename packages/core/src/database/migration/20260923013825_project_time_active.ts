import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260923013825_project_time_active",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`time_active\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`UPDATE \`project\` SET \`time_active\` = \`time_updated\`;`)
    })
  },
}

export default migration
