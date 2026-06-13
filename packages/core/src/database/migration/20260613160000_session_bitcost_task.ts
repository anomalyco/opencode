import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260613160000_session_bitcost_task",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session\`)`)
      const has = (name: string) => columns.some((column) => column.name === name)
      if (!has("bitcost_task_id")) yield* tx.run(`ALTER TABLE \`session\` ADD \`bitcost_task_id\` text;`)
      if (!has("time_completed")) yield* tx.run(`ALTER TABLE \`session\` ADD \`time_completed\` integer;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_bitcost_task_idx\` ON \`session\` (\`bitcost_task_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
