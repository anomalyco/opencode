export * as Detaching from "./detaching.js"

import { Context, Duration, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

// What detaching hooks may take together: shutdown should not wait on them.
const HOOK_BUDGET = Duration.millis(500)

/**
 * Planned-shutdown state of this server process.
 *
 * A prepared daemon handoff means a new server will take over the daemon's processes. If this server
 * then shuts down, it is detaching: work that can outlive it in the daemon is left running and recorded
 * for the new server instead of being stopped. Without a prepared handoff (a normal quit), shutdown
 * stops everything as before.
 */
export interface Interface {
  /** Records that a daemon handoff was prepared successfully. */
  readonly handoffPrepared: Effect.Effect<void>
  /** Records that the prepared handoff no longer holds: the daemon was shut down, so nothing can outlive this server. */
  readonly handoffDropped: Effect.Effect<void>
  /**
   * Called once shutdown starts, before any service is torn down. Returns whether this server is detaching,
   * after running the detaching hooks (best effort, bounded) when it is.
   */
  readonly begin: Effect.Effect<boolean>
  readonly isDetaching: () => boolean
  /** Whether shutdown has started, detaching or not. Interrupts from then on are not the user's. */
  readonly isStopping: () => boolean
  /** Runs `hook` when this server starts detaching, while every service is still open. Removed with the scope. */
  readonly onDetach: (hook: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Detaching") {}

export const make = Effect.sync(() => {
  let prepared = false
  let detaching = false
  let stopping = false
  const hooks = new Set<Effect.Effect<void>>()
  return Service.of({
    handoffPrepared: Effect.sync(() => {
      prepared = true
    }),
    handoffDropped: Effect.sync(() => {
      prepared = false
    }),
    begin: Effect.gen(function* () {
      stopping = true
      detaching = prepared
      if (!detaching) return false
      yield* Effect.forEach(hooks, (hook) => hook.pipe(Effect.catchCause(() => Effect.void)), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(Effect.timeoutOption(HOOK_BUDGET))
      return true
    }),
    isDetaching: () => detaching,
    isStopping: () => stopping,
    onDetach: (hook) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // A fresh reference per registration, so the same effect can be registered twice.
          const entry = Effect.suspend(() => hook)
          hooks.add(entry)
          return entry
        }),
        (entry) => Effect.sync(() => hooks.delete(entry)),
      ).pipe(Effect.asVoid),
  })
})

export const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
