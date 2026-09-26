import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260917212851_db_projector_hot_paths",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`part_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_time_created_idx\`;`)
      // `event_seq_idx (seq)` never served a query (every read leads with aggregate_id),
      // so it is replaced by the composite message index below.
      yield* tx.run(`DROP INDEX IF EXISTS \`event_seq_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`event_message_id_idx\`;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`event_message_id_idx\` ON \`event\` (\`aggregate_id\`,json_extract("data", '$.messageID'));`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_project_time_updated_idx\` ON \`session\` (\`project_id\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`session_time_updated_idx\` ON \`session\` (\`time_updated\`,\`id\`);`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_directory_time_updated_idx\` ON \`session\` (\`directory\`,\`time_updated\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
