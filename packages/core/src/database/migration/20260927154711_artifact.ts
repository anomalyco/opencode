import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260927154711_artifact",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`artifact_comment\` (
          \`id\` text PRIMARY KEY,
          \`artifact_id\` text NOT NULL,
          \`author\` text NOT NULL,
          \`body\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_artifact_comment_artifact_id_artifact_id_fk\` FOREIGN KEY (\`artifact_id\`) REFERENCES \`artifact\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`artifact\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`session_id\` text,
          \`name\` text NOT NULL,
          \`type\` text NOT NULL,
          \`status\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`agent\` text,
          \`task\` text,
          \`content\` text NOT NULL,
          \`diff\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_artifact_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_artifact_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`artifact_comment_artifact_idx\` ON \`artifact_comment\` (\`artifact_id\`);`)
      yield* tx.run(`CREATE INDEX \`artifact_project_idx\` ON \`artifact\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`artifact_session_idx\` ON \`artifact\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
