import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812223059_session_budget",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`budget\` real;`)
    })
  },
} satisfies DatabaseMigration.Migration
