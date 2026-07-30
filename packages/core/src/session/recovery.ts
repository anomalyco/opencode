export * as SessionRecovery from "./recovery"

import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import { MessageTable, SessionTable } from "./sql"

/**
 * Recovers sessions that were interrupted by a crash or forced restart.
 *
 * When the process crashes while an LLM response is in flight, the last
 * assistant message may have been persisted (via durable PartUpdated events)
 * but never received its completion timestamp (time.completed). This routine
 * finds such sessions and marks the incomplete message as interrupted so it
 * doesn't appear as a stuck/in-progress session.
 */
export const recover = Effect.fn("SessionRecovery.recover")(function* () {
  const { db } = yield* Database.Service

  // Find assistant messages where time.completed was never set
  // (crashed before the step-finish or cleanup handler ran).
  // The data column stores the full message JSON, including the nested
  // time.completed field. We use json_extract to check inside it.
  const rows = yield* db
    .select({ session_id: MessageTable.session_id, message_id: MessageTable.id })
    .from(MessageTable)
    .where(
      and(
        sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
        sql`json_extract(${MessageTable.data}, '$.time.completed') IS NULL`,
      ),
    )
    .all()
    .pipe(Effect.orDie)

  if (rows.length === 0) return

  yield* Effect.logInfo("Recovering interrupted sessions", { count: rows.length })

  const recoveredSessionIDs = new Set<string>()

  for (const row of rows) {
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const now = Date.now()

        // Set time.completed to now so the message is no longer "in-flight"
        yield* tx
          .run(
            sql`UPDATE ${MessageTable}
                SET data = json_set(data, '$.time.completed', ${now})
                WHERE ${eq(MessageTable.id, row.message_id)}
                  AND ${eq(MessageTable.session_id, row.session_id)}`,
          )
          .pipe(Effect.orDie)

        // Mark the message as having been interrupted by setting its finish
        // reason, but only if no finish reason was already set (e.g. the
        // provider returned "stop" but time.completed was never written).
        yield* tx
          .run(
            sql`UPDATE ${MessageTable}
                SET data = json_set(
                  data,
                  '$.finish',
                  'interrupted',
                  '$.error',
                  json_object('name', 'MessageAbortedError', 'data', json_object('message', 'Session was interrupted by a crash or restart'))
                )
                WHERE ${eq(MessageTable.id, row.message_id)}
                  AND ${eq(MessageTable.session_id, row.session_id)}
                  AND json_extract(data, '$.finish') IS NULL`,
          )
          .pipe(Effect.orDie)
      }),
    )

    recoveredSessionIDs.add(row.session_id)

    yield* Effect.logWarning("Recovered interrupted session", {
      sessionID: row.session_id,
      messageID: row.message_id,
    })
  }

  // Update session timestamps once per affected session
  const now = Date.now()
  for (const sessionID of recoveredSessionIDs) {
    yield* db
      .update(SessionTable)
      .set({ time_updated: now })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
  }

  yield* Effect.logInfo("Session recovery complete", {
    messagesRecovered: rows.length,
    sessionsAffected: recoveredSessionIDs.size,
  })
})
