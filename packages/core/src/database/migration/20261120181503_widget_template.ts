import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261120181503_widget_template",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`widget_template\` (
          \`name\` text NOT NULL,
          \`version\` text NOT NULL,
          \`description\` text NOT NULL,
          \`data\` text NOT NULL,
          \`source\` text NOT NULL,
          \`builtin\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`widget_template_pk\` PRIMARY KEY(\`name\`, \`version\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`widget_template_latest_idx\` ON \`widget_template\` (\`name\`,\`time_updated\`);`)
    })
  },
}

export default migration
