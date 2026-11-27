import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261123115523_space",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`space\` (
          \`space\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`revision\` integer NOT NULL,
          CONSTRAINT \`space_pk\` PRIMARY KEY(\`space\`, \`key\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`space_revision_idx\` ON \`space\` (\`space\`,\`revision\`);`)
      yield* tx.run(
        `CREATE INDEX \`space_live_idx\` ON \`space\` (\`space\`,\`revision\`) WHERE "space"."value" is not null;`,
      )
      yield* tx.run(
        `CREATE INDEX \`space_tombstone_idx\` ON \`space\` (\`space\`,\`revision\`,\`value\`) WHERE "space"."value" is null;`,
      )
    })
  },
}

export default migration
