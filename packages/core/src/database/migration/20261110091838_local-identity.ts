import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261110091838_local-identity",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`server_session\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text,
          \`method\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`revoked_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_server_session_user_id_server_user_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`server_user\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`server_user\` (
          \`id\` text PRIMARY KEY,
          \`method\` text NOT NULL,
          \`username\` text NOT NULL,
          \`display_name\` text,
          \`email\` text,
          \`password_hash\` text,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`server_session_user_id_idx\` ON \`server_session\` (\`user_id\`);`)
      yield* tx.run(`CREATE INDEX \`server_session_expires_at_idx\` ON \`server_session\` (\`expires_at\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`server_user_method_username_idx\` ON \`server_user\` (\`method\`,\`username\`);`,
      )
      yield* tx.run(`CREATE INDEX \`server_user_method_idx\` ON \`server_user\` (\`method\`);`)
    })
  },
}

export default migration
