import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260615050011_real_rachel_grey",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workflow_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text,
          \`directory\` text DEFAULT '' NOT NULL,
          \`workflow\` text NOT NULL,
          \`status\` text NOT NULL,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`current_phase\` text,
          \`args\` text,
          \`definition\` text,
          \`logs\` text NOT NULL,
          \`agents\` text NOT NULL,
          \`result\` text,
          \`error\` text,
          \`resume_of\` text,
          \`pending_question\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`workflow_run_started_at_idx\` ON \`workflow_run\` (\`started_at\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_run_status_started_at_idx\` ON \`workflow_run\` (\`status\`,\`started_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
