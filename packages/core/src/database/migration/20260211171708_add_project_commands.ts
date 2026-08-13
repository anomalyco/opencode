import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260211171708_add_project_commands",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`commands\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
