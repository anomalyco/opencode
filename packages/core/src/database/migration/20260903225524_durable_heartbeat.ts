import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260903225524_durable_heartbeat",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`heartbeat\` (
          \`job_id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`task\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`status\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`check_number\` integer NOT NULL,
          \`max_checks\` integer NOT NULL,
          \`delay_seconds\` integer NOT NULL,
          \`initial_delay_seconds\` integer NOT NULL,
          \`interval_seconds\` integer NOT NULL,
          \`backoff\` text NOT NULL,
          \`max_interval_seconds\` integer NOT NULL,
          \`next_delay_seconds\` integer NOT NULL,
          \`scheduled_at\` integer NOT NULL,
          \`fires_at\` integer NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_heartbeat_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`heartbeat_session_task_idx\` ON \`heartbeat\` (\`session_id\`,\`task\`);`)
      yield* tx.run(`CREATE INDEX \`heartbeat_status_fires_idx\` ON \`heartbeat\` (\`status\`,\`fires_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
