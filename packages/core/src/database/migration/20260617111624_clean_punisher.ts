import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260617111624_clean_punisher",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`zero_memory\` (
          \`id\` text PRIMARY KEY,
          \`content\` text NOT NULL,
          \`embedding\` text NOT NULL,
          \`metadata\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`zero_schedule\` (
          \`id\` text PRIMARY KEY,
          \`cron\` text NOT NULL,
          \`command\` text NOT NULL,
          \`last_run\` integer,
          \`next_run\` integer NOT NULL,
          \`active\` integer DEFAULT 1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
