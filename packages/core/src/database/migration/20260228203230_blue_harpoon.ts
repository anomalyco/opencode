import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260228203230_blue_harpoon",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`selected_org_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY NOT NULL,
          \`active_account_id\` text,
          FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON UPDATE no action ON DELETE set null
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
