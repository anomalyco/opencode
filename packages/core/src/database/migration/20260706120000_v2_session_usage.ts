import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260706120000_v2_session_usage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE session
        SET
          cost = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.cost'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0),
          tokens_input = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.tokens.input'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0),
          tokens_output = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.tokens.output'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0),
          tokens_reasoning = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.tokens.reasoning'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0),
          tokens_cache_read = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.tokens.cache.read'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0),
          tokens_cache_write = coalesce((
            SELECT sum(coalesce(json_extract(session_message.data, '$.tokens.cache.write'), 0))
            FROM session_message
            WHERE session_message.session_id = session.id
              AND session_message.type = 'assistant'
          ), 0)
        WHERE EXISTS (
          SELECT 1
          FROM session_message
          WHERE session_message.session_id = session.id
        )
      `)
    })
  },
} satisfies DatabaseMigration.Migration
