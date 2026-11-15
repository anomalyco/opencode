import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261115234412_video_generation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`generation\` (
          \`id\` text PRIMARY KEY,
          \`kind\` text NOT NULL,
          \`model\` text NOT NULL,
          \`provider_job_id\` text,
          \`status\` text NOT NULL,
          \`reason\` text,
          \`error\` text,
          \`media\` text,
          \`request\` text NOT NULL,
          \`expires_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`blob\` ADD \`expires_at\` integer;`)
      yield* tx.run(`CREATE INDEX \`generation_status_idx\` ON \`generation\` (\`status\`);`)
      yield* tx.run(
        `CREATE INDEX \`blob_expires_at_idx\` ON \`blob\` (\`expires_at\`) WHERE "blob"."expires_at" IS NOT NULL;`,
      )
    })
  },
}

export default migration
