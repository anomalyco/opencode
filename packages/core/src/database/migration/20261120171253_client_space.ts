import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261120171253_client_space",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`client_space\` (
          \`space\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`revision\` integer NOT NULL,
          CONSTRAINT \`client_space_pk\` PRIMARY KEY(\`space\`, \`key\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`client_space_revision_idx\` ON \`client_space\` (\`space\`,\`revision\`);`)
    })
  },
}

export default migration
