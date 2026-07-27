import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260727145922_cron_job",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`cron_job\` (
          \`id\` text PRIMARY KEY,
          \`name\` text,
          \`prompt\` text NOT NULL,
          \`schedule_kind\` text NOT NULL,
          \`schedule_expr\` text NOT NULL,
          \`enabled\` integer DEFAULT 1 NOT NULL,
          \`state\` text DEFAULT 'scheduled' NOT NULL,
          \`next_run_at\` integer,
          \`last_run_at\` integer,
          \`last_status\` text,
          \`last_error\` text,
          \`model\` text,
          \`skills\` text,
          \`workdir\` text,
          \`repeat_times\` integer,
          \`repeat_done\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`token_balance\` ADD \`lastAllowanceMonth\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
