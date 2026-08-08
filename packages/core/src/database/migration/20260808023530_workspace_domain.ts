import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

const migration: DatabaseMigration.Migration = {
  id: "20260808023530_workspace_domain",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`workspace\`;`)
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`provider\` text NOT NULL,
          \`binding\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`last_used_at\` integer NOT NULL
        );
      `)
    })
  },
}

export default migration
