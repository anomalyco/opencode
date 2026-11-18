import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029165540_schedule_checks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`check\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`checks\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`failures\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`state\` text;`)
    })
  },
}

export default migration
