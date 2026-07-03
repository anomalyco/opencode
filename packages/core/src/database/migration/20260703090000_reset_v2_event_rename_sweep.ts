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
      // `created` column is added by the generated 20260703181610_event_created_column
      // migration, which runs after this wipe (NOT NULL without default is safe on the
      // emptied table).
    })
  },
} satisfies DatabaseMigration.Migration
