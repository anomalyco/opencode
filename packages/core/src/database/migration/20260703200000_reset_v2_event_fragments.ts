import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260703200000_reset_v2_event_fragments",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DELETE FROM \`session_input\`;`)
      yield* tx.run(`DELETE FROM \`session_message\`;`)
      yield* tx.run(`DELETE FROM \`event\`;`)
      yield* tx.run(`DELETE FROM \`event_sequence\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
