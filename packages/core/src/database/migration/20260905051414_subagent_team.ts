import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260905051414_subagent_team",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_team_member\` (
          \`id\` text PRIMARY KEY,
          \`parent_id\` text NOT NULL,
          \`team_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`role\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_team_member_parent_id_session_v2_id_fk\` FOREIGN KEY (\`parent_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_team_member_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_team_member_parent_team_idx\` ON \`session_team_member\` (\`parent_id\`,\`team_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_team_member_session_idx\` ON \`session_team_member\` (\`session_id\`);`,
      )
    })
  },
}

export default migration
