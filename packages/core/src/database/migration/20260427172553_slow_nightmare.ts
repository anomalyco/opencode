import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260427172553_slow_nightmare",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_entry_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_entry_session_type_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_entry_time_created_idx\`;`)
      yield* tx.run(`CREATE INDEX \`session_message_session_idx\` ON \`session_message\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_idx\` ON \`session_message\` (\`session_id\`,\`type\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`DROP TABLE \`session_entry\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
