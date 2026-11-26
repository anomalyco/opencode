import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261120170614_event_usage_recorded_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`event_usage_recorded_created_idx\` ON \`event\` (\`created\`,\`aggregate_id\`) WHERE "event"."type" = 'session.usage.recorded.1';`,
      )
    })
  },
}

export default migration
