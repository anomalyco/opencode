import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261031043534_session_inbox_resume",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_inbox\` ADD \`resume\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_inbox\` ADD \`resume_retired\` integer DEFAULT false NOT NULL;`)
    })
  },
}

export default migration
