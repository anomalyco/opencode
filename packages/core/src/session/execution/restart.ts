export * as SessionRestart from "./restart"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../../bus"
import { SessionEvent } from "../event"
import { SessionExecution } from "../execution"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"

const CONTINUE_AFTER_SERVER_RESTART =
  "The server restarted while you were working. Continue from where you left off without repeating completed work."

const RESUME_EXHAUSTED = {
  type: "aborted",
  message: "Execution was interrupted repeatedly and will not be resumed automatically.",
} as const

export interface Options {
  /**
   * Times a single turn may be resumed before it is terminalized instead.
   * The counter is durable and only a terminal event resets it, so a turn
   * that keeps dying cannot crash-loop across restarts. Turns that complete
   * never accumulate: the budget is per-turn, not per-session.
   */
  readonly maxAttempts?: number
}

const DEFAULT_MAX_ATTEMPTS = 10

export interface Interface {
  /**
   * Resumes Sessions whose execution claim was never released — turns orphaned
   * by a process that died without teardown, or interrupted by a graceful
   * shutdown (which preserves the claim on purpose). The claim is never
   * cleared here: only a terminal event releases it, so a death anywhere in
   * the resume path leaves the same orphaned claim for the next boot.
   */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Recovery for orphaned executions. Claims are written at turn start by
 * SessionExecution, so this sweep needs no cooperation from the previous
 * process: crash, SIGKILL, isolate eviction, and graceful restart all leave
 * the same durable signature.
 *
 * The sweep assumes every orphaned claim's owner is dead. The managed-server
 * protocol guarantees this: a successor is only spawned after the previous
 * process is confirmed dead (client service `kill`/`evict` poll the PID), the
 * registration lock admits one managed server at a time, and unregistered
 * servers sharing the database never sweep. The service is inert until called
 * — the managed server invokes it at boot; embedders may call it from their
 * own start-up.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const execution = yield* SessionExecution.Service
      const bus = yield* Bus.Service
      const scope = yield* Effect.scope
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

      const resumeOne = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts === undefined) return // the Session was deleted since listing
        if (attempts > maxAttempts) {
          // Terminalize instead: the release hook clears the claim and resets the
          // counter atomically with the terminal event.
          yield* bus.publish(
            SessionEvent.Execution.Failed,
            { sessionID, error: RESUME_EXHAUSTED },
            { commit: () => store.release(sessionID) },
          )
          return
        }
        yield* bus.publish(SessionEvent.Synthetic, {
          sessionID,
          text: CONTINUE_AFTER_SERVER_RESTART,
          description: "Continuing after restart",
        })
        // Forked into the service scope so boot never waits on resumed turns;
        // resuming an already-live Session joins its execution. Drain failures
        // are logged and durably recorded by the execution layer.
        yield* execution.resume(sessionID).pipe(Effect.ignore, Effect.forkIn(scope))
      })

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          // Child claims never drive recovery (children are not resumed), so a
          // dead child's claim is noise no terminal will ever release. Clearing
          // is safe even against a live child: claims are recovery markers, not
          // locks, and children are excluded from that recovery.
          yield* store.releaseChildClaims
          const active = yield* execution.active
          // Sessions already draining in this process keep their claim; resuming
          // them would only inject a stray continuation into a live turn.
          const orphaned = (yield* store.listSuspended()).filter((sessionID) => !active.has(sessionID))
          yield* Effect.forEach(orphaned, resumeOne, { concurrency: "unbounded", discard: true })
        }),
      })
    }),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node, Bus.node],
})
