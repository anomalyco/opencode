import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260824140000_normalize_tool_part_input",
  up(tx) {
    return Effect.gen(function* () {
      // Legacy tool parts stored state.input as a JSON string. Parse objects in
      // place and fall back to {} when the string is truncated or not an object.
      yield* tx.run(`
        UPDATE part
        SET data = json_set(
          data,
          '$.state.input',
          CASE
            WHEN json_valid(json_extract(data, '$.state.input'))
              AND json_type(json(json_extract(data, '$.state.input'))) = 'object'
              THEN json(json_extract(data, '$.state.input'))
            ELSE json('{}')
          END
        )
        WHERE json_extract(data, '$.type') = 'tool'
          AND json_type(data, '$.state.input') = 'text'
      `)
    })
  },
} satisfies DatabaseMigration.Migration
