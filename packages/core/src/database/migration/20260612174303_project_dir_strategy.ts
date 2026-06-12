import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260612174303_project_dir_strategy",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project_directory\` ADD \`strategy\` text;`)
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_project_directory\`(\`project_id\`, \`directory\`, \`type\`, \`time_created\`) SELECT \`project_id\`, \`directory\`, \`type\`, \`time_created\` FROM \`project_directory\`;`,
      )
      yield* tx.run(`DROP TABLE \`project_directory\`;`)
      yield* tx.run(`ALTER TABLE \`__new_project_directory\` RENAME TO \`project_directory\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
