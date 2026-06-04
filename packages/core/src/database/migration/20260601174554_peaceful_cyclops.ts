import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260601174554_peaceful_cyclops",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_mailbox\` (
          \`id\` text PRIMARY KEY,
          \`from_session_id\` text,
          \`to_session_id\` text NOT NULL,
          \`root_session_id\` text,
          \`kind\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`state\` text NOT NULL,
          \`text\` text NOT NULL,
          \`metadata\` text,
          \`claim_id\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_processing\` integer,
          \`time_completed\` integer,
          CONSTRAINT \`fk_session_mailbox_to_session_id_session_id_fk\` FOREIGN KEY (\`to_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_mailbox_target_state_kind_fifo_idx\` ON \`session_mailbox\` (\`to_session_id\`,\`state\`,\`kind\`,\`time_created\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_mailbox_target_delivery_fifo_idx\` ON \`session_mailbox\` (\`to_session_id\`,\`delivery\`,\`time_created\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_mailbox_claim_idx\` ON \`session_mailbox\` (\`claim_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
