import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261128193337_blob_catalog",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`blob_data\` (
          \`blob_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`data\` blob NOT NULL,
          CONSTRAINT \`blob_data_pk\` PRIMARY KEY(\`blob_id\`, \`seq\`),
          CONSTRAINT \`fk_blob_data_blob_id_blob_v2_id_fk\` FOREIGN KEY (\`blob_id\`) REFERENCES \`blob_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`blob_v2\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text,
          \`mime\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`name\` text,
          \`width\` integer,
          \`height\` integer,
          \`duration_ms\` integer,
          \`metadata\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`blob_v2_session_idx\` ON \`blob_v2\` (\`session_id\`,\`time_created\`) WHERE "blob_v2"."session_id" is not null;`,
      )
    })
  },
}

export default migration
