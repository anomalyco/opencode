import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261025123711_blob",
  up(tx) {
    return Effect.gen(function* () {
      // Databases upgraded through the V1→V2 data migration carry an unused
      // legacy `blob(id, data)` table from that baseline. Rename it aside so
      // the content-addressed `blob` below can be created; nothing references
      // the legacy table and any rows survive the rename. A table that already
      // has the new shape is left alone and fails loudly instead of being
      // silently replaced.
      const blobColumns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`blob\`)`)
      if (blobColumns.length > 0 && !blobColumns.some((column) => column.name === "hash"))
        yield* tx.run(`ALTER TABLE \`blob\` RENAME TO \`blob_v1_legacy\``)
      yield* tx.run(`
        CREATE TABLE \`blob_ref\` (
          \`session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`hash\` text NOT NULL,
          \`seq\` integer NOT NULL,
          CONSTRAINT \`blob_ref_pk\` PRIMARY KEY(\`session_id\`, \`message_id\`, \`hash\`),
          CONSTRAINT \`fk_blob_ref_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_blob_ref_hash_blob_hash_fk\` FOREIGN KEY (\`hash\`) REFERENCES \`blob\`(\`hash\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`blob\` (
          \`hash\` text PRIMARY KEY,
          \`mime\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`width\` integer,
          \`height\` integer,
          \`data\` blob NOT NULL,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`blob_ref_hash_idx\` ON \`blob_ref\` (\`hash\`);`)
      yield* tx.run(`CREATE INDEX \`blob_ref_session_seq_idx\` ON \`blob_ref\` (\`session_id\`,\`seq\`);`)
    })
  },
}

export default migration
