import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261012112921_modern_red_wolf",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`session_id\` text PRIMARY KEY,
          \`goal_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`objective\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`blocked_reason\` text,
          \`max_goal_rounds\` integer DEFAULT 8 NOT NULL,
          \`rounds\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_todo\` (
          \`session_id\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`acceptance\` text,
          \`feedback\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_todo_pk\` PRIMARY KEY(\`session_id\`, \`position\`),
          CONSTRAINT \`fk_session_todo_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
