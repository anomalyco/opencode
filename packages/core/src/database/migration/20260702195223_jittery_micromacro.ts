import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260702195223_jittery_micromacro",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`token_balance\` (
          \`userId\` text PRIMARY KEY,
          \`balance\` integer DEFAULT 0 NOT NULL,
          \`lifetimeUsed\` integer DEFAULT 0 NOT NULL,
          \`updatedAt\` integer NOT NULL,
          CONSTRAINT \`fk_token_balance_userId_user_identity_id_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`user_identity\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`token_transaction\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`userId\` text NOT NULL,
          \`amount\` integer NOT NULL,
          \`description\` text,
          \`sessionId\` text,
          \`model\` text,
          \`tokensUsed\` integer,
          \`costUsd\` real,
          \`createdAt\` integer NOT NULL,
          CONSTRAINT \`fk_token_transaction_userId_user_identity_id_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`user_identity\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`user_identity\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`displayName\` text,
          \`tenantId\` text,
          \`createdAt\` integer NOT NULL,
          \`lastLoginAt\` integer NOT NULL,
          \`isAdmin\` integer DEFAULT 0 NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`idx_tx_user\` ON \`token_transaction\` (\`userId\`,\`createdAt\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
