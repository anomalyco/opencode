import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261031034751_marketplace",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`marketplace_artifact\` (
          \`digest\` text PRIMARY KEY,
          \`size\` integer NOT NULL,
          \`media_type\` text,
          \`kind\` text NOT NULL,
          \`source_url\` text,
          \`time_created\` integer NOT NULL,
          \`time_accessed\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_audit\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`revision\` integer NOT NULL,
          \`action\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_fetch\` (
          \`key\` text PRIMARY KEY,
          \`url\` text NOT NULL,
          \`digest\` text NOT NULL,
          \`etag\` text,
          \`last_modified\` text,
          \`status\` integer NOT NULL,
          \`time_fetched\` integer NOT NULL,
          CONSTRAINT \`fk_marketplace_fetch_digest_marketplace_artifact_digest_fk\` FOREIGN KEY (\`digest\`) REFERENCES \`marketplace_artifact\`(\`digest\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_install\` (
          \`key\` text PRIMARY KEY,
          \`data\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_materialization\` (
          \`digest\` text PRIMARY KEY,
          \`path\` text NOT NULL,
          \`artifacts\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_accessed\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_registry\` (
          \`id\` integer PRIMARY KEY,
          \`revision\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`marketplace_source\` (
          \`id\` text PRIMARY KEY,
          \`data\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`marketplace_artifact_accessed_idx\` ON \`marketplace_artifact\` (\`time_accessed\`);`,
      )
      yield* tx.run(`CREATE INDEX \`marketplace_audit_revision_idx\` ON \`marketplace_audit\` (\`revision\`);`)
      yield* tx.run(`CREATE INDEX \`marketplace_fetch_digest_idx\` ON \`marketplace_fetch\` (\`digest\`);`)
      yield* tx.run(`CREATE INDEX \`marketplace_fetch_time_idx\` ON \`marketplace_fetch\` (\`time_fetched\`);`)
      yield* tx.run(`CREATE INDEX \`marketplace_install_position_idx\` ON \`marketplace_install\` (\`position\`);`)
      yield* tx.run(
        `CREATE INDEX \`marketplace_materialization_accessed_idx\` ON \`marketplace_materialization\` (\`time_accessed\`);`,
      )
      yield* tx.run(`CREATE INDEX \`marketplace_source_position_idx\` ON \`marketplace_source\` (\`position\`);`)
    })
  },
}

export default migration
