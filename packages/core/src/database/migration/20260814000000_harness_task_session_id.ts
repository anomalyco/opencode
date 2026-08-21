import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260814000000_harness_task_session_id",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`harness_task\`)`)
      if (columns.some((column) => column.name === "session_id")) return
      yield* tx.run(`ALTER TABLE \`harness_task\` ADD \`session_id\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
