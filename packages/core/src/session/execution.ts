export * as SessionExecution from "./execution"

import { Cause, Context, Effect, Exit, Layer } from "effect"
import { EventV2 } from "../event"
import { LocationServiceMap } from "../location-service-map"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionRunCoordinator } from "./run-coordinator"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { toSessionError } from "./to-session-error"
import { UserInterruptedError } from "./error"

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Resolves once this process owns no active execution for the Session. Returns immediately when idle and never starts work. */
  readonly awaitIdle: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionExecution") {}

type InterruptReason = "user" | "shutdown" | "superseded"

export function terminal(exit: Exit.Exit<void, SessionRunner.RunError>, reason?: InterruptReason) {
  if (Exit.isSuccess(exit)) return { type: "succeeded" as const }
  if (Cause.hasInterrupts(exit.cause)) return { type: "interrupted" as const, reason: reason ?? "shutdown" }
  const failure = Cause.squash(exit.cause)
  if (failure instanceof UserInterruptedError) return { type: "interrupted" as const, reason: "user" as const }
  return { type: "failed" as const, error: toSessionError(failure) }
}

/** Process-local execution: drains run in this process, routed through the Session's Location graph. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
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
    // Starting or finishing on its own clears stale suspension; interruption preserves it because
    // managed-server teardown suspends active Sessions immediately before interrupting their drains.
    const clearSuspensionOnCommit = (sessionID: SessionSchema.ID) => ({
      commit: () => Effect.asVoid(store.consumeSuspended(sessionID)),
    })
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError, InterruptReason>({
      started: (sessionID) =>
        reportLifecycle(
          sessionID,
          events.publish(SessionEvent.Execution.Started, { sessionID }, clearSuspensionOnCommit(sessionID)),
        ),
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
              yield* events.publish(SessionEvent.Execution.Succeeded, { sessionID }, clearSuspensionOnCommit(sessionID))
              return
            }
            if (outcome.type === "interrupted") {
              yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: outcome.reason })
              return
            }
            yield* events.publish(
              SessionEvent.Execution.Failed,
              {
                sessionID,
                error: outcome.error,
              },
              clearSuspensionOnCommit(sessionID),
            )
          }),
        ),
    })

    return Service.of({
      active: coordinator.active,
      interrupt: (sessionID) => coordinator.interrupt(sessionID, "user"),
      resume: coordinator.run,
      wake: coordinator.wake,
      awaitIdle: coordinator.awaitIdle,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node, EventV2.node],
})

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    awaitIdle: () => Effect.void,
  }),
)
