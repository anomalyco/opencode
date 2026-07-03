import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260703090000_reset_v2_event_rename_sweep",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DELETE FROM \`session_input\`;`)
      yield* tx.run(`DELETE FROM \`session_message\`;`)
      yield* tx.run(`DELETE FROM \`event\`;`)
      yield* tx.run(`DELETE FROM \`event_sequence\`;`)
      yield* tx.run(`ALTER TABLE \`event\` ADD COLUMN \`created\` integer NOT NULL DEFAULT 0;`)
    })
  },
} satisfies DatabaseMigration.Migration
