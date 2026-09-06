import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260801203430_long_puppet_master",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`automation_trigger\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`schedule\` text NOT NULL,
          \`enabled\` integer DEFAULT true NOT NULL,
          \`agent\` text,
          \`last_fired\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_automation_trigger_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`automation_trigger_session_idx\` ON \`automation_trigger\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`automation_trigger_enabled_idx\` ON \`automation_trigger\` (\`enabled\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
