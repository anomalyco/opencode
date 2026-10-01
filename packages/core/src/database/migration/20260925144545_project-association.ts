import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260925144545_project-association",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`project_association\` (
          \`directory\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_project_association_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`project_association_project_id_idx\` ON \`project_association\` (\`project_id\`);`)
      yield* tx.run(`
        INSERT OR REPLACE INTO \`project_association\` (\`directory\`, \`project_id\`, \`strategy\`, \`time_created\`)
        SELECT \`directory\`, \`project_id\`, \`strategy\`, \`time_created\`
        FROM \`project_directory\`
        WHERE \`type\` = 'association';
      `)
      yield* tx.run(`DELETE FROM \`project_directory\` WHERE \`type\` = 'association';`)
    })
  },
} satisfies DatabaseMigration.Migration
