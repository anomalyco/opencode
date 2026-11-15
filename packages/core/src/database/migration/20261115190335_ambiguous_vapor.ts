import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261115190335_ambiguous_vapor",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_question\` ADD \`status\` text DEFAULT 'pending' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_question\` ADD \`answer\` text;`)
      yield* tx.run(`ALTER TABLE \`session_question\` ADD \`cancel_message\` text;`)
    })
  },
}

export default migration
