export * as BitcostReporter from "./reporter"

import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionTable } from "../session/sql"
import { BitcostClient } from "./client"

type StepEnded = EventV2.Data<typeof SessionEvent.Step.Ended>

/**
 * Subscribes to per-turn usage events and reports them to bitcost, stamped with
 * the session's bound task. Fire-and-forget and non-blocking: each report is
 * forked so the agent loop is never stalled, and failures are dropped (usage is
 * best-effort telemetry). Sessions without a bound task, or when not logged in,
 * are skipped.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const client = yield* BitcostClient.Service

    yield* events.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== SessionEvent.Step.Ended.type) return
        const data = event.data as StepEnded

        const row = yield* db
          .select({ taskID: SessionTable.bitcost_task_id, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, data.sessionID))
          .get()
          .pipe(Effect.orElseSucceed(() => undefined))

        if (!row?.taskID || !row.model) return

        const report: BitcostClient.UsageReport = {
          taskID: row.taskID,
          idempotencyKey: data.assistantMessageID,
          session: data.sessionID,
          provider: row.model.providerID,
          model: row.model.id,
          variant: row.model.variant,
          tokens: data.tokens,
        }

        // Fork so the publish path returns immediately; swallow failures.
        yield* Effect.forkDetach(client.reportUsage(report).pipe(Effect.catchCause(() => Effect.void)))
      }),
    )
  }),
)

export const node = LayerNode.make(layer, [EventV2.node, Database.node, BitcostClient.node])
