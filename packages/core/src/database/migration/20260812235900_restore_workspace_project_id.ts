import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812235900_restore_workspace_project_id",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`workspace\`)`)
      if (columns.some((column) => column.name === "project_id")) return

      // Some builds replaced `workspace` with a provider/binding table and
      // dropped `project_id`. Project ID remaps and workspace queries still
      // expect the control-plane schema.
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`DROP TABLE IF EXISTS \`workspace\`;`)
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`name\` text DEFAULT '' NOT NULL,
          \`branch\` text,
          \`directory\` text,
          \`extra\` text,
          \`project_id\` text NOT NULL,
          \`time_used\` integer NOT NULL,
          CONSTRAINT \`fk_workspace_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
