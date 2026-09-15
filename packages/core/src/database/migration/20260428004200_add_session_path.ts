import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260428004200_add_session_path",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`path\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
