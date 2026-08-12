import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260812213948_worktree",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`worktree\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`worktree_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_worktree_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`worktree\` (\`project_id\`, \`directory\`, \`strategy\`, \`time_created\`)
        SELECT
          \`project_id\`,
          \`directory\`,
          CASE
            WHEN \`strategy\` = 'git_worktree' THEN 'git'
            WHEN \`strategy\` IS NOT NULL THEN \`strategy\`
            WHEN \`type\` = 'git_worktree' THEN 'git'
          END,
          \`time_created\`
        FROM \`project_directory\`;
      `)
    })
  },
}

export default migration
