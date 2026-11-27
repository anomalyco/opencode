import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261127150308_saved-tool",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`saved_tool\` (
          \`scope\` text NOT NULL,
          \`name\` text NOT NULL,
          \`description\` text NOT NULL,
          \`input\` text NOT NULL,
          \`output\` text,
          \`code\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`saved_tool_pk\` PRIMARY KEY(\`scope\`, \`name\`)
        );
      `)
    })
  },
}

export default migration
