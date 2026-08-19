import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260818120000_workflow",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workflow_preference\` (
          \`project_id\` text PRIMARY KEY,
          \`architect\` text,
          \`coder\` text,
          \`concurrency\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_workflow_preference_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`workflow\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`story\` text NOT NULL,
          \`status\` text NOT NULL,
          \`architect\` text NOT NULL,
          \`coder\` text NOT NULL,
          \`concurrency\` integer NOT NULL,
          \`tasks\` text NOT NULL,
          \`attempts\` text NOT NULL,
          \`sessions\` text NOT NULL,
          \`branch\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_workflow_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`workflow_project_status_idx\` ON \`workflow\` (\`project_id\`,\`status\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
