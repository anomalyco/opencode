import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260213144116_wakeful_the_professor",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
