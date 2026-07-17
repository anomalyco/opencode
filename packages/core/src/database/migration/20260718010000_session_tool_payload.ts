import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718010000_session_tool_payload",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_tool_payload\` (
          \`session_id\` text NOT NULL,
          \`hash\` text NOT NULL,
          \`value\` text NOT NULL,
          PRIMARY KEY(\`session_id\`, \`hash\`),
          FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE cascade
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
