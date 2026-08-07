export * as SessionRestart from "./restart"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../../bus"
import { SessionEvent } from "../event"
import { SessionExecution } from "../execution"
import { SessionStore } from "../store"

const CONTINUE_AFTER_SERVER_RESTART =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

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
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const execution = yield* SessionExecution.Service
    const bus = yield* Bus.Service
    return Service.of({
      suspendActiveSessions: Effect.gen(function* () {
        yield* store.suspend(yield* execution.active)
      }),
      resumeSuspendedSessions: Effect.gen(function* () {
        const sessions = yield* store.listSuspended()
        yield* Effect.forEach(
          sessions,
          (sessionID) =>
            Effect.gen(function* () {
              if (!(yield* store.consumeSuspended(sessionID))) return
              yield* bus.publish(SessionEvent.Synthetic, {
                sessionID,
                text: CONTINUE_AFTER_SERVER_RESTART,
                description: "Continuing after restart",
              })
              // Drain failures are already logged and durably recorded by the execution layer.
              yield* Effect.ignore(execution.resume(sessionID))
            }),
          { concurrency: "unbounded", discard: true },
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionStore.node, SessionExecution.node, Bus.node],
})
