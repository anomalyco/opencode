import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261106020704_session_tunnel",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_tunnel\` (
          \`id\` text PRIMARY KEY,
          \`from_session_id\` text NOT NULL,
          \`from_agent\` text,
          \`to_session_id\` text NOT NULL,
          \`to_agent\` text,
          \`kind\` text NOT NULL,
          \`body\` text NOT NULL,
          \`sequence\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_tunnel_from_session_id_session_v2_id_fk\` FOREIGN KEY (\`from_session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_tunnel_to_session_id_session_v2_id_fk\` FOREIGN KEY (\`to_session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_tunnel_from_idx\` ON \`session_tunnel\` (\`from_session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_tunnel_to_idx\` ON \`session_tunnel\` (\`to_session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_tunnel_to_sequence_idx\` ON \`session_tunnel\` (\`to_session_id\`,\`sequence\`);`,
      )
    })
  },
}

export default migration
