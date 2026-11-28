import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029184115_mcp_trusted_host",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`mcp_trusted_host\` (
          \`project_id\` text NOT NULL,
          \`host\` text NOT NULL,
          \`port\` integer NOT NULL,
          \`fingerprint\` text NOT NULL,
          \`subject\` text NOT NULL,
          \`valid_to\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`mcp_trusted_host_pk\` PRIMARY KEY(\`project_id\`, \`host\`, \`port\`),
          CONSTRAINT \`fk_mcp_trusted_host_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
