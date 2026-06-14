export * as BitcostReporter from "./reporter"

import { eq } from "drizzle-orm"
import { Effect, Layer, Schema, SynchronizedRef } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { AbsolutePath, NonNegativeInt } from "../schema"
import { SessionV2 } from "../session"
import { SessionEvent } from "../session/event"
import { SessionTable } from "../session/sql"
import { WorkspaceV2 } from "../workspace"
import { BitcostClient } from "./client"

type StepEnded = EventV2.Data<typeof SessionEvent.Step.Ended>

export const StatusUpdated = EventV2.define({
  type: "bitcost.report.status.updated",
  schema: {
    sessionID: SessionV2.ID,
    attempts: NonNegativeInt,
    successes: NonNegativeInt,
    failures: NonNegativeInt,
    last: Schema.Literals(["success", "failure"]),
  },
})

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
 * loop is never stalled. Sessions without a bound task, or when not logged in,
 * are skipped.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const client = yield* BitcostClient.Service
    const statuses = yield* SynchronizedRef.make(
      new Map<string, { attempts: number; successes: number; failures: number }>(),
    )

    yield* events.listen((event) => {
      // Runs in AppRuntime, where Step.Ended is PUBLISHED: publish notifies
      // listeners directly. (project/projectors only fire on the durable-commit
      // path, which for Step.Ended happens in the server-group instance via
      // replay — not here — so a projector here would never fire.)
      if (event.type !== SessionEvent.Step.Ended.type) return Effect.void
      const data = event.data as StepEnded
      // Detach so the publish path is never blocked and a report failure can
      // never break the listener. The session-row read + POST run on a fiber.
      return Effect.sync(() => {
        Effect.runFork(
          Effect.gen(function* () {
            const row = yield* db
            .select({
              taskID: SessionTable.bitcost_task_id,
              model: SessionTable.model,
              directory: SessionTable.directory,
              workspaceID: SessionTable.workspace_id,
            })
            .from(SessionTable)
            .where(eq(SessionTable.id, data.sessionID))
            .get()
            .pipe(Effect.orElseSucceed(() => undefined))

          if (!row?.taskID || !row.model) return

          const report: BitcostClient.UsageReport = {
            taskID: row.taskID,
            idempotencyKey: data.assistantMessageID,
            requestID: `usage:${row.taskID}:${data.assistantMessageID}`,
            session: data.sessionID,
            provider: row.model.providerID,
            model: row.model.id,
            variant: row.model.variant,
            cost: data.cost,
            tokens: data.tokens,
          }
          const location = Location.Ref.make({
            directory: AbsolutePath.make(row.directory),
            workspaceID: row.workspaceID ? WorkspaceV2.ID.make(row.workspaceID) : undefined,
          })

          const publishStatus = (last: "success" | "failure") =>
            Effect.gen(function* () {
              const status = yield* SynchronizedRef.modify(statuses, (current) => {
                const previous = current.get(data.sessionID) ?? { attempts: 0, successes: 0, failures: 0 }
                const next = {
                  attempts: previous.attempts + 1,
                  successes: previous.successes + (last === "success" ? 1 : 0),
                  failures: previous.failures + (last === "failure" ? 1 : 0),
                }
                return [next, new Map(current).set(data.sessionID, next)] as const
              })
              yield* events.publish(
                StatusUpdated,
                {
                  sessionID: data.sessionID,
                  attempts: status.attempts,
                  successes: status.successes,
                  failures: status.failures,
                  last,
                },
                { location },
              )
            })

          yield* client.reportUsage(report).pipe(
            Effect.tap(() => publishStatus("success")),
            Effect.catchCause(() => publishStatus("failure")),
          )
          }).pipe(Effect.catchCause(() => Effect.void)),
        )
      })
    })
  }),
)

export const node = LayerNode.make(layer, [EventV2.node, Database.node, BitcostClient.node])

/**
 * Standalone layer for `AppRuntime` (app-runtime.ts `Layer.mergeAll`). The
 * reporter MUST run in the runtime where session turns publish `Step.Ended`:
 * the server-group instance only receives V1 events via sync replay, never the
 * V2 Step.Ended, so a server-group registration never fires.
 */
export const defaultLayer = layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(BitcostClient.defaultLayer),
)
