import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260726234822_add_session_status_pid",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_status\` ADD \`pid\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
