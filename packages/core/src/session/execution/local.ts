import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer } from "effect"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { EventTable } from "../../event/sql"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionEvent } from "../event"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { toSessionError } from "../to-session-error"
import { UserInterruptedError } from "../error"
import { EffectFlock } from "../../util/effect-flock"

export function terminal(exit: Exit.Exit<void, SessionRunner.RunError>, reason?: "user" | "shutdown" | "superseded") {
  if (Exit.isSuccess(exit)) return { type: "succeeded" as const }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted" as const, reason: reason ?? "shutdown" }
  const failure = Cause.squash(exit.cause)
  if (failure instanceof UserInterruptedError) return { type: "interrupted" as const, reason: "user" as const }
  return { type: "failed" as const, error: toSessionError(failure) }
}

export const sessionsInterruptedByShutdown = Effect.fn("SessionExecutionLocal.sessionsInterruptedByShutdown")(
  function* (db: Database.Interface["db"]) {
    const latest = yield* db.all<{ sessionID: string; type: string; reason: string | null }>(sql`
      SELECT aggregate_id AS sessionID, type, json_extract(data, '$.reason') AS reason
      FROM (
        SELECT aggregate_id, type, data,
          row_number() OVER (PARTITION BY aggregate_id ORDER BY seq DESC) AS rank
        FROM ${EventTable}
        WHERE type IN (
          ${EventV2.versionedType(SessionEvent.Execution.Started.type, 1)},
          ${EventV2.versionedType(SessionEvent.Execution.Succeeded.type, 1)},
          ${EventV2.versionedType(SessionEvent.Execution.Failed.type, 1)},
          ${EventV2.versionedType(SessionEvent.Execution.Interrupted.type, 1)}
        )
      )
      WHERE rank = 1
    `)
    return latest
      .filter(
        (event) =>
          event.type === EventV2.versionedType(SessionEvent.Execution.Interrupted.type, 1) &&
          event.reason === "shutdown",
      )
      .map((event) => SessionSchema.ID.make(event.sessionID))
  },
)

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const flock = yield* EffectFlock.Service
    const { db } = yield* Database.Service
    const reportLifecycle = <A>(sessionID: SessionSchema.ID, effect: Effect.Effect<A>) =>
      effect.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError("Failed to publish Session execution lifecycle", cause).pipe(
                Effect.annotateLogs({ sessionID }),
              ),
        ),
        Effect.asVoid,
      )
    const coordinator = yield* SessionRunCoordinator.make<
      SessionSchema.ID,
      SessionRunner.RunError,
      "user" | "shutdown" | "superseded"
    >({
      started: (sessionID) => reportLifecycle(sessionID, events.publish(SessionEvent.Execution.Started, { sessionID })),
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
        return yield* SessionRunner.Service.use((runner) => runner.drain({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
          ),
        )
      }),
      // One terminal observation per busy period, covering every coalesced drain.
      settled: (sessionID, exit, reason) =>
        reportLifecycle(
          sessionID,
          Effect.gen(function* () {
            const outcome = terminal(exit, reason)
            if (outcome.type === "succeeded") {
              yield* events.publish(SessionEvent.Execution.Succeeded, { sessionID })
              return
            }
            if (outcome.type === "interrupted") {
              yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: outcome.reason })
              return
            }
            yield* events.publish(SessionEvent.Execution.Failed, {
              sessionID,
              error: outcome.error,
            })
          }),
        ),
    })

    yield* flock
      .withLock(
        Effect.gen(function* () {
          const interrupted = yield* sessionsInterruptedByShutdown(db)
          yield* Effect.forEach(
            interrupted,
            (sessionID) =>
              coordinator.run(sessionID).pipe(
                Effect.tapCause((cause) =>
                  Effect.logError("Failed to recover Session after shutdown", cause).pipe(
                    Effect.annotateLogs({ sessionID }),
                  ),
                ),
                Effect.ignore,
              ),
            { concurrency: "unbounded", discard: true },
          )
        }),
        "session-shutdown-recovery",
      )
      .pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to acquire Session recovery ownership", cause)),
        Effect.ignore,
        Effect.forkScoped,
      )

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: (sessionID) => coordinator.interrupt(sessionID, "user"),
      resume: coordinator.run,
      wake: coordinator.wake,
      awaitIdle: coordinator.awaitIdle,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node, Database.node, EffectFlock.node],
})

export * as SessionExecutionLocal from "./local"
