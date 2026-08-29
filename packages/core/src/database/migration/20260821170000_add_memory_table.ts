import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821170000_add_memory_table",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`memory\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`source\` text NOT NULL,
          \`session_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_memory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`memory_project_idx\` ON \`memory\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`memory_project_source_idx\` ON \`memory\` (\`project_id\`, \`source\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
