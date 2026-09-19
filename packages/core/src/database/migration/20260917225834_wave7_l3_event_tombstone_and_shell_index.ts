import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260917225834_wave7_l3_event_tombstone_and_shell_index",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`event\`)`)
      if (!columns.some((column) => column.name === "tombstone_digest")) {
        yield* tx.run(`ALTER TABLE \`event\` ADD \`tombstone_digest\` text;`)
      }
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_message_session_call_id_seq_idx\` ON \`session_message\` (\`session_id\`,json_extract("data", '$.callID'),\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
