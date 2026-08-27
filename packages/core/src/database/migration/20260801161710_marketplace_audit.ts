import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260801161710_marketplace_audit",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`marketplace_audit\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`revision\` integer NOT NULL,
          \`action\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`marketplace_audit_revision_idx\` ON \`marketplace_audit\` (\`revision\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
