import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029002625_session_part",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_part\` (
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`call_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_part_pk\` PRIMARY KEY(\`message_id\`, \`ordinal\`),
          CONSTRAINT \`fk_session_part_message_id_session_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`session_message\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_part_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_part_session_message_idx\` ON \`session_part\` (\`session_id\`,\`message_id\`,\`ordinal\`);`,
      )
    })
  },
}

export default migration
