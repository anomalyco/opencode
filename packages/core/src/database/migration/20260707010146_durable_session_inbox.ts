import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260707010146_durable_session_inbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`prompt\` text,
          \`delivery\` text,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_session_input\`(\`id\`, \`session_id\`, \`type\`, \`prompt\`, \`delivery\`, \`admitted_seq\`, \`promoted_seq\`, \`time_created\`) SELECT \`id\`, \`session_id\`, 'prompt', \`prompt\`, \`delivery\`, \`admitted_seq\`, \`promoted_seq\`, \`time_created\` FROM \`session_input\`;`,
      )
      yield* tx.run(`DROP TABLE \`session_input\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session_input\` RENAME TO \`session_input\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_input_session_pending_delivery_seq_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_type_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`type\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_pending_compaction_idx\` ON \`session_input\` (\`session_id\`) WHERE "session_input"."type" = 'compaction' and "session_input"."promoted_seq" is null;`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
