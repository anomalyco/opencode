import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260410174513_workspace-name",
  up(tx) {
    return Effect.gen(function* () {
      const columns = new Set(
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`workspace\`)`)).map((column) => column.name),
      )
      const select = [
        "`id`",
        columns.has("type") ? "`type`" : "'branch' AS `type`",
        columns.has("branch") ? "`branch`" : "NULL AS `branch`",
        columns.has("name") ? "`name`" : "'' AS `name`",
        columns.has("directory") ? "`directory`" : "NULL AS `directory`",
        columns.has("extra") ? "`extra`" : "NULL AS `extra`",
        "`project_id`",
      ].join(", ")

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
      yield* tx.run(`INSERT INTO \`__new_workspace\`(\`id\`, \`type\`, \`branch\`, \`name\`, \`directory\`, \`extra\`, \`project_id\`) SELECT ${select} FROM \`workspace\`;`)
      yield* tx.run(`DROP TABLE \`workspace\`;`)
      yield* tx.run(`ALTER TABLE \`__new_workspace\` RENAME TO \`workspace\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
