import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260626200000_project_archived",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`time_archived\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
