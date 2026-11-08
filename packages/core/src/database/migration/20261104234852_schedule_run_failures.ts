import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261104234852_schedule_run_failures",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`run_failures\` integer DEFAULT 0 NOT NULL;`)
    })
  },
}

export default migration
