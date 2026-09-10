import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260905155702_stats-covering-index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_message_stats_idx\` ON \`session_message\` (\`time_created\`,\`session_id\`,\`type\`,json_extract("data", '$.model.providerID'),json_extract("data", '$.model.id'),json_extract("data", '$.model.variant'),json_extract("data", '$.tokens.input'),json_extract("data", '$.tokens.output'),json_extract("data", '$.tokens.reasoning'),json_extract("data", '$.tokens.cache.read'),json_extract("data", '$.tokens.cache.write'),json_extract("data", '$.cost'));`,
      )
    })
  },
}

export default migration
