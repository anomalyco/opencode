import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823000000_add_recall_chunk",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`recall_chunk\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`part_id\` text NOT NULL,
          \`chunk_index\` integer NOT NULL,
          \`provider\` text NOT NULL,
          \`dim\` integer NOT NULL,
          \`model_id\` text NOT NULL,
          \`text_hash\` text NOT NULL,
          \`text\` text NOT NULL,
          \`vec\` blob NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`recall_chunk_session_idx\` ON \`recall_chunk\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`recall_chunk_part_idx\` ON \`recall_chunk\` (\`part_id\`);`)
      yield* tx.run(`CREATE INDEX \`recall_chunk_message_idx\` ON \`recall_chunk\` (\`message_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
