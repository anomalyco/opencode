import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260722011141_delete_tool_progress_events",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DELETE FROM \`event\` WHERE \`type\` = 'session.tool.progress.1';`)
    })
  },
} satisfies DatabaseMigration.Migration
