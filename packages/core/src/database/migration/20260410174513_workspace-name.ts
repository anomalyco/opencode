import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260410174513_workspace-name",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_workspace\`(\`id\`, \`type\`, \`branch\`, \`name\`, \`directory\`, \`extra\`, \`project_id\`) SELECT \`id\`, \`type\`, \`branch\`, \`name\`, \`directory\`, \`extra\`, \`project_id\` FROM \`workspace\`;`,
      )
      yield* tx.run(`DROP TABLE \`workspace\`;`)
      yield* tx.run(`ALTER TABLE \`__new_workspace\` RENAME TO \`workspace\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
