import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261116181958_automation_event_position",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`automation\` ADD \`event_position\` text;`)
    })
  },
}

export default migration
