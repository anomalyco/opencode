import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261105195531_session_search",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_search_dirty\` (
          \`source_id\` text PRIMARY KEY
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_search_document\` (
          \`id\` integer PRIMARY KEY,
          \`source_id\` text NOT NULL,
          \`session_id\` text NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_search_document_source_idx\` ON \`session_search_document\` (\`source_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_search_document_session_idx\` ON \`session_search_document\` (\`session_id\`);`,
      )
    })
  },
}

export default migration
