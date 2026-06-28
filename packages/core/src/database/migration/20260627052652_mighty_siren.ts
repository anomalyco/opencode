import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260627052652_mighty_siren",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`task\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`command\` text NOT NULL,
          \`cwd\` text NOT NULL,
          \`status\` text NOT NULL,
          \`pid\` integer,
          \`port\` integer,
          \`exit_code\` integer,
          \`error\` text,
          \`started_at\` integer NOT NULL,
          \`completed_at\` integer,
          \`metadata\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
