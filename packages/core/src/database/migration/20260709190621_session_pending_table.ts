import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709190621_session_pending_table",
  up(tx) {
    return Effect.gen(function* () {
      // The table becomes pending-only: promoted and settled rows are consumed
      // state whose durable truth lives in `session_message` and the event log.
      yield* tx.run(`DELETE FROM \`session_input\` WHERE \`promoted_seq\` IS NOT NULL;`)
      // Databases migrated through interim v2 builds carry index sets from any
      // point in history, and the partial index embeds the qualified table
      // name, so every index must drop before the rename and the column drop.
      const indexes = yield* tx.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session_input' AND name NOT LIKE 'sqlite_%'`,
      )
      for (const index of indexes) yield* tx.run(`DROP INDEX IF EXISTS \`${index.name}\`;`)
      yield* tx.run(`ALTER TABLE \`session_input\` RENAME TO \`session_pending\`;`)
      yield* tx.run(`ALTER TABLE \`session_pending\` DROP COLUMN \`promoted_seq\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_pending_session_delivery_seq_idx\` ON \`session_pending\` (\`session_id\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_pending_session_compaction_idx\` ON \`session_pending\` (\`session_id\`) WHERE "session_pending"."type" = 'compaction';`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_pending_session_admitted_seq_idx\` ON \`session_pending\` (\`session_id\`,\`admitted_seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
