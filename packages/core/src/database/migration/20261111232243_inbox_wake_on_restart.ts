import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261111232243_inbox_wake_on_restart",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_inbox\` ADD \`wake_on_restart\` integer DEFAULT false NOT NULL;`)
    })
  },
}

export default migration
