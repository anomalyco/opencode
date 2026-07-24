import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260724103001_session_list_indexes",
  up(tx) {
    return Effect.gen(function* () {
      // drizzle-kit does not diff index column lists, so widening an existing
      // index has to be written by hand or migrated databases keep the narrow
      // one forever and diverge from schema.gen.ts. DROP then CREATE rather
      // than CREATE IF NOT EXISTS, which would silently retain the old shape.
      yield* tx.run(`DROP INDEX IF EXISTS \`session_project_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_parent_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_time_updated_idx\`;`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`,\`time_updated\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`,\`time_updated\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_time_updated_idx\` ON \`session\` (\`time_updated\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
