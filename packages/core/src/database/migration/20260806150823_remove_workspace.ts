import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260806150823_remove_workspace",
  up(tx) {
    return Effect.gen(function* () {
      // Legacy control-plane workspace references would otherwise route these
      // sessions to hosted graphs whose workspace rows no longer exist.
      yield* tx.run(`UPDATE \`session_v2\` SET \`workspace_id\` = NULL WHERE \`workspace_id\` IS NOT NULL;`)
      yield* tx.run(`DROP TABLE \`workspace\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
