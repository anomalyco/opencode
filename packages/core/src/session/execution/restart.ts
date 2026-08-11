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

export interface Options {
  /**
   * Times a single turn may be resumed before it is terminalized instead.
   * The counter is durable and only a terminal event resets it, so a turn
   * that keeps dying cannot crash-loop across restarts. Turns that complete
   * never accumulate: the budget is per-turn, not per-session.
   */
  readonly maxAttempts?: number
  /**
   * Claims whose aggregate saw a durable event more recently than this are
   * deferred: another process may still be draining the turn (managed-server
   * handoff overlap). Deferred claims are re-checked once after
   * `redriveDelayMs` and otherwise left for the next start.
   */
  readonly graceMs?: number
  readonly redriveDelayMs?: number
}

const DEFAULT_MAX_ATTEMPTS = 10
const DEFAULT_GRACE_MS = 15_000
const DEFAULT_REDRIVE_DELAY_MS = 20_000

export interface Interface {
  /**
   * Resumes Sessions whose execution claim was never released — turns orphaned
   * by a process that died without teardown, or interrupted by a graceful
   * shutdown (which preserves the claim on purpose). Each claim is consumed
   * atomically, so a Session resumes at most once per sweep.
   */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Recovery for orphaned executions. Claims are written at turn start by
 * SessionExecution, so this sweep needs no cooperation from the previous
 * process: crash, SIGKILL, isolate eviction, and graceful restart all leave
 * the same durable signature. The service is inert until called — the managed
 * server invokes it at boot; embedders that can die without teardown call it
 * from their own start-up.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const execution = yield* SessionExecution.Service
      const bus = yield* Bus.Service
      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS
      const redriveDelayMs = options?.redriveDelayMs ?? DEFAULT_REDRIVE_DELAY_MS

      /** Claims with message activity inside the grace window may belong to a live drain elsewhere. */
      const settled = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        const lastActivityAt = yield* store.lastActivityAt(sessionID)
        return lastActivityAt === undefined || Date.now() - lastActivityAt >= graceMs
      })

      const resumeOne = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
        // Durable before the resume runs, so a crash inside the resumed turn is
        // counted by the next sweep and the budget cannot be dodged.
        const attempts = yield* store.countResume(sessionID)
        if (attempts > maxAttempts) {
          // Terminalize instead: the release hook clears the claim and resets the
          // counter atomically with the terminal event.
          yield* bus.publish(
            SessionEvent.Execution.Failed,
            {
              sessionID,
              error: {
                type: "aborted",
                message: "Execution was interrupted repeatedly and will not be resumed automatically.",
              },
            },
            { commit: () => store.release(sessionID) },
          )
          return
        }
        if (!(yield* store.consumeSuspended(sessionID))) return
        yield* bus.publish(SessionEvent.Synthetic, {
          sessionID,
          text: CONTINUE_AFTER_SERVER_RESTART,
          description: "Continuing after restart",
        })
        // Drain failures are already logged and durably recorded by the execution layer.
        yield* Effect.ignore(execution.resume(sessionID))
      })

      const sweep = (sessionIDs: ReadonlyArray<SessionSchema.ID>) =>
        Effect.forEach(
          sessionIDs,
          (sessionID) =>
            Effect.gen(function* () {
              if (yield* settled(sessionID)) return yield* resumeOne(sessionID)
              return sessionID
            }),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => results.filter((result) => result !== undefined)))

      return Service.of({
        resumeSuspendedSessions: Effect.gen(function* () {
          // Sessions already draining in this process keep their claim; resuming
          // them would only inject a stray continuation into a live turn.
          const active = yield* execution.active
          const claimed = (yield* store.listSuspended()).filter((sessionID) => !active.has(sessionID))
          const deferred = yield* sweep(claimed)
          if (deferred.length === 0) return
          // One redrive covers the managed-server handoff overlap: the previous
          // server's drains are interrupted moments after this one boots. Claims
          // still active after the delay wait for the next start.
          yield* Effect.sleep(redriveDelayMs)
          const activeNow = yield* execution.active
          yield* sweep(deferred.filter((sessionID) => !activeNow.has(sessionID)))
        }),
      })
    }),
  )

export const configured = (options?: Options) =>
  makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [SessionStore.node, SessionExecution.node, Bus.node],
  })

export const node = configured()
