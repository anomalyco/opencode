import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802011651_automation_enhancements",
  up(tx) {
    return Effect.gen(function* () {
      // Add lock columns to automation_trigger
      yield* tx.run(`ALTER TABLE \`automation_trigger\` ADD COLUMN \`locked\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`automation_trigger\` ADD COLUMN \`lock_owner\` text;`)
      yield* tx.run(`ALTER TABLE \`automation_trigger\` ADD COLUMN \`lock_expires\` integer;`)
      yield* tx.run(`CREATE INDEX \`automation_trigger_locked_idx\` ON \`automation_trigger\` (\`locked\`);`)

      // Create automation_run table
      yield* tx.run(`
        CREATE TABLE \`automation_run\` (
          \`id\` text PRIMARY KEY,
          \`trigger_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`status\` text NOT NULL CHECK (\`status\` IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          \`prompt\` text NOT NULL,
          \`agent\` text,
          \`error\` text,
          \`payload\` text,
          \`time_started\` integer NOT NULL,
          \`time_completed\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_automation_run_trigger_id_automation_trigger_id_fk\` FOREIGN KEY (\`trigger_id\`) REFERENCES \`automation_trigger\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`automation_run_trigger_idx\` ON \`automation_run\` (\`trigger_id\`);`)
      yield* tx.run(`CREATE INDEX \`automation_run_session_idx\` ON \`automation_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`automation_run_status_idx\` ON \`automation_run\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`automation_run_time_idx\` ON \`automation_run\` (\`time_started\`);`)
    })
  },
} satisfies DatabaseMigration.Migration