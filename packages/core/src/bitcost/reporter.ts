export * as BitcostReporter from "./reporter"

import { eq } from "drizzle-orm"
import { Cause, Effect, Layer } from "effect"
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

        // DIAGNOSTIC: confirms the listener actually receives Step.Ended.
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
          // DIAGNOSTIC: explains why a turn produced no usage report.
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

        // DIAGNOSTIC: about to POST. Logs the resolved task/model.
        yield* Effect.logInfo("bitcost.reporter: reporting usage").pipe(
          Effect.annotateLogs({ taskID: report.taskID, provider: report.provider, model: report.model }),
        )

        // Fork so the publish path returns immediately. Failures are best-effort
        // telemetry but we now LOG them (status/cause) instead of swallowing, so a
        // silently-failing POST is visible in the CLI log.
        yield* Effect.forkDetach(
          client.reportUsage(report).pipe(
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
          ),
        )
      }),
    )
  }),
)

export const node = LayerNode.make(layer, [EventV2.node, Database.node, BitcostClient.node])
