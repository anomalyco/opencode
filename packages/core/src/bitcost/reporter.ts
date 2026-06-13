export * as BitcostReporter from "./reporter"

import { eq } from "drizzle-orm"
import { Cause, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionTable } from "../session/sql"
import { BitcostClient } from "./client"

/**
 * Reports per-turn usage to bitcost, stamped with the session's bound task.
 *
 * Uses `events.project` (NOT `events.listen`): this layer's EventV2 instance
 * receives durable session events via sync replay, and the replay path drives
 * projectors but not listen() listeners (event.ts `replay` only notifies
 * listeners when `publish: true`). The session token projector receives
 * Step.Ended the same way, so this is the channel that actually fires per turn.
 *
 * Fire-and-forget and non-blocking: the report is forked so the commit/agent
 * loop is never stalled, and failures are logged (best-effort telemetry).
 * Sessions without a bound task, or when not logged in, are skipped.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const client = yield* BitcostClient.Service

    yield* Effect.logInfo("bitcost.reporter: subscribed to event stream")

    yield* events.project(SessionEvent.Step.Ended, (event) => {
      const data = event.data
      // Detach so the commit transaction is never blocked and a report failure
      // can never break the projector. The session-row read + POST run outside
      // the commit on the forked fiber.
      return Effect.forkDetach(
        Effect.gen(function* () {
          yield* Effect.logInfo("bitcost.reporter: Step.Ended received").pipe(
            Effect.annotateLogs({ sessionID: data.sessionID }),
          )

          const row = yield* db
            .select({ taskID: SessionTable.bitcost_task_id, model: SessionTable.model })
            .from(SessionTable)
            .where(eq(SessionTable.id, data.sessionID))
            .get()
            .pipe(Effect.orElseSucceed(() => undefined))

          if (!row?.taskID || !row.model) {
            yield* Effect.logInfo("bitcost.reporter: skipped (no bound task or model on session row)").pipe(
              Effect.annotateLogs({ sessionID: data.sessionID, hasTask: !!row?.taskID, hasModel: !!row?.model }),
            )
            return
          }

          const report: BitcostClient.UsageReport = {
            taskID: row.taskID,
            idempotencyKey: data.assistantMessageID,
            session: data.sessionID,
            provider: row.model.providerID,
            model: row.model.id,
            variant: row.model.variant,
            tokens: data.tokens,
          }

          yield* Effect.logInfo("bitcost.reporter: reporting usage").pipe(
            Effect.annotateLogs({ taskID: report.taskID, provider: report.provider, model: report.model }),
          )

          yield* client.reportUsage(report).pipe(
            Effect.tap(() =>
              Effect.logInfo("bitcost.reporter: usage reported OK").pipe(
                Effect.annotateLogs({ taskID: report.taskID, key: report.idempotencyKey }),
              ),
            ),
            Effect.catchCause((cause) =>
              Effect.logError("bitcost.reporter: reportUsage FAILED").pipe(
                Effect.annotateLogs({ taskID: report.taskID, cause: Cause.pretty(cause) }),
              ),
            ),
          )
        }).pipe(Effect.catchCause(() => Effect.void)),
      ).pipe(Effect.asVoid)
    })
  }),
)

export const node = LayerNode.make(layer, [EventV2.node, Database.node, BitcostClient.node])
