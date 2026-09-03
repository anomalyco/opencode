import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260902000000_compaction_model",
  up(tx) {
    return Effect.gen(function* () {
      // Old checkpoints have no provider state. Infer display provenance without
      // treating a nearby model as proof that it produced replayable provider data.
      for (const table of ["session_message", "event"] as const) {
        const session = table === "session_message" ? "session_id" : "aggregate_id"
        yield* tx.run(`
          UPDATE ${table} AS checkpoint
          SET data = json_set(checkpoint.data, '$.model', json(coalesce(
            (
              SELECT json_extract(source.data, '$.model') FROM session_message AS source
              WHERE source.session_id = checkpoint.${session}
                AND source.type IN ('assistant', 'model-switched')
                AND json_type(source.data, '$.model') = 'object'
                AND source.seq < checkpoint.seq
              ORDER BY source.seq DESC LIMIT 1
            ),
            (
              SELECT json_extract(source.data, '$.model') FROM event AS source
              WHERE source.aggregate_id = checkpoint.${session}
                AND source.type IN ('session.step.started.1', 'session.model.selected.1', 'session.created.1')
                AND json_type(source.data, '$.model') = 'object'
                AND source.seq < checkpoint.seq
              ORDER BY source.seq DESC LIMIT 1
            ),
            (
              SELECT json_extract(source.data, '$.model') FROM session_message AS source
              WHERE source.session_id = checkpoint.${session}
                AND source.type IN ('assistant', 'model-switched')
                AND json_type(source.data, '$.model') = 'object'
                AND source.seq > checkpoint.seq
              ORDER BY source.seq ASC LIMIT 1
            ),
            (
              SELECT json_extract(source.data, '$.model') FROM event AS source
              WHERE source.aggregate_id = checkpoint.${session}
                AND source.type IN ('session.step.started.1', 'session.model.selected.1', 'session.created.1')
                AND json_type(source.data, '$.model') = 'object'
                AND source.seq > checkpoint.seq
              ORDER BY source.seq ASC LIMIT 1
            ),
            (SELECT model FROM session_v2 WHERE id = checkpoint.${session}),
            '{"id":"unknown","providerID":"unknown"}'
          )))
          WHERE checkpoint.type = '${table === "session_message" ? "compaction" : "session.compaction.ended.1"}'
            ${table === "session_message" ? "AND json_extract(checkpoint.data, '$.status') = 'completed'" : ""}
            AND json_type(checkpoint.data, '$.model') IS NULL
        `)
      }
    })
  },
}

export default migration
