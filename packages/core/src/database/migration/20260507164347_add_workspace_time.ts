import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

const migration: DatabaseMigration.Migration = {
  id: "20260507164347_add_workspace_time",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workspace\` ADD \`time_used\` integer NOT NULL DEFAULT 0;`)
    })
  },
}

export default migration
