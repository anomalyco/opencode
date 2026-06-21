import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260617164142_clammy_plazm",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`zero_code_index\` (
          \`id\` text PRIMARY KEY,
          \`filepath\` text NOT NULL,
          \`content\` text NOT NULL,
          \`embedding\` text NOT NULL,
          \`metadata\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
