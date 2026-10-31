import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261101000018_schedule_run_inbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`schedule_run\` (
          \`id\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`schedule_name\` text,
          \`owner_session_id\` text,
          \`session_id\` text,
          \`run\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`attention\` text DEFAULT 'quiet' NOT NULL,
          \`summary\` text,
          \`error\` text,
          \`reported_attention\` text,
          \`reported_summary\` text,
          \`next_in_ms\` integer,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`read_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_schedule_run_schedule_id_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`schedule\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_schedule_run_owner_session_id_session_v2_id_fk\` FOREIGN KEY (\`owner_session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`schedule_run_schedule_idx\` ON \`schedule_run\` (\`schedule_id\`,\`started_at\`);`)
      yield* tx.run(
        `CREATE INDEX \`schedule_run_session_running_idx\` ON \`schedule_run\` (\`session_id\`) WHERE "schedule_run"."status" = 'running' and "schedule_run"."session_id" is not null;`,
      )
      yield* tx.run(
        `CREATE INDEX \`schedule_run_inbox_idx\` ON \`schedule_run\` (\`owner_session_id\`,\`started_at\`) WHERE "schedule_run"."attention" in ('ready', 'needs_you') and "schedule_run"."read_at" is null;`,
      )
    })
  },
}

export default migration
