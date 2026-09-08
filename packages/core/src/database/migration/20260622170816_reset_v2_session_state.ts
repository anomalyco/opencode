import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260622170816_reset_v2_session_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DELETE FROM \`session_context_epoch\`;`)
      yield* tx.run(`DELETE FROM \`session_input\`;`)
      yield* tx.run(`DELETE FROM \`session_message\`;`)
      yield* tx.run(`DELETE FROM \`event\`;`)
      yield* tx.run(`DELETE FROM \`event_sequence\`;`)
      yield* tx.run(`UPDATE \`session\` SET \`workspace_id\` = NULL WHERE \`workspace_id\` IS NOT NULL;`)
      yield* tx.run(`DELETE FROM \`workspace\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
