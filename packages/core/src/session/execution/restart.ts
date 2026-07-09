export * as SessionRestart from "./restart"

import { Cause, Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionExecution } from "../execution"
import { SessionStore } from "../store"

export interface Interface {
  /**
   * Marks every execution active in this process for resumption by the next server start.
   * Call once new work has stopped arriving and before teardown interrupts the drains.
   */
  readonly suspendActiveSessions: Effect.Effect<void>
  /** Resumes suspended Sessions. Each suspension is consumed atomically, so a Session resumes at most once. */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Restart continuity actions for the managed server. The service is inert until called: only the
 * managed server invokes it, so default, embedded, and stdio servers never suspend or auto-resume.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRestart") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    return Service.of({
      suspendActiveSessions: Effect.gen(function* () {
        const active = yield* execution.active
        yield* Effect.forEach(Array.from(active), (sessionID) => store.setSuspended(sessionID, true), {
          discard: true,
        })
      }),
      resumeSuspendedSessions: Effect.gen(function* () {
        const sessions = yield* store.listSuspended()
        yield* Effect.forEach(
          sessions,
          (sessionID) =>
            Effect.gen(function* () {
              if (!(yield* store.consumeSuspended(sessionID))) return
              yield* execution.resume(sessionID).pipe(
                Effect.tapCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.void
                    : Effect.logError("Failed to resume suspended Session", cause).pipe(
                        Effect.annotateLogs({ sessionID }),
                      ),
                ),
                Effect.ignore,
              )
            }),
          // Suspensions are consumed one at a time; the bounded concurrency only overlaps the drains.
          { concurrency: 4, discard: true },
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [SessionStore.node, SessionExecution.node] })
