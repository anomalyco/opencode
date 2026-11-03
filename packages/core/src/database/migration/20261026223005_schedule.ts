import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261026223005_schedule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`schedule\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text,
          \`name\` text,
          \`action\` text NOT NULL,
          \`when\` text NOT NULL,
          \`tz\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`next_due_at\` integer,
          \`ends_at\` integer,
          \`remaining_runs\` integer,
          \`run_count\` integer DEFAULT 0 NOT NULL,
          \`last_fired_at\` integer,
          \`last_message_id\` text,
          \`last_outcome\` text,
          \`retry_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_schedule_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`schedule_session_idx\` ON \`schedule\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`schedule_due_idx\` ON \`schedule\` (\`next_due_at\`) WHERE "schedule"."status" = 'active' and "schedule"."next_due_at" is not null;`,
      )
    })
  },
}

export default migration
