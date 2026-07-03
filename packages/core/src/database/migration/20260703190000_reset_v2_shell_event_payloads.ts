import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260703190000_reset_v2_shell_event_payloads",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DELETE FROM \`session_input\`;`)
      yield* tx.run(`DELETE FROM \`session_message\`;`)
      yield* tx.run(`DELETE FROM \`event\`;`)
      yield* tx.run(`DELETE FROM \`event_sequence\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
