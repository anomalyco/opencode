export * as ClaudeStatus from "./status.js"

import { Effect, Semaphore, SubscriptionRef } from "effect"
import type { ClaudeIO } from "./io.js"
import { ClaudeProbe } from "./probe.js"
import { ClaudeQueryOptions } from "./query-options.js"

export type State =
  | { readonly type: "checking" }
  | { readonly type: "missing" }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "ready"; readonly probe: ClaudeProbe.Result }

export interface Interface {
  readonly state: SubscriptionRef.SubscriptionRef<State>
  readonly refresh: () => Effect.Effect<void>
  // What a chat's own process found when it started
  readonly report: (next: State) => Effect.Effect<void>
}

export const make = Effect.fn("ClaudeStatus.make")(function* (io: ClaudeIO.Interface) {
  const state = yield* SubscriptionRef.make<State>({ type: "checking" })
  const lock = yield* Semaphore.make(1)

  // Serialized so a reconnect checks again after startup, rather than racing it with an older account snapshot.
  const refresh = Effect.fn("ClaudeStatus.refresh")(function* () {
    const executable = io.which()
    if (!executable) return yield* SubscriptionRef.set(state, { type: "missing" })
    const next = yield* ClaudeProbe.run(ClaudeQueryOptions.base({ executable, io })).pipe(
      Effect.map((probe): State => ({ type: "ready", probe })),
      Effect.catch((error) =>
        Effect.logWarning("Claude Code login check failed", { cause: error.cause }).pipe(
          Effect.as<State>({ type: "failed", message: String(error.cause) }),
        ),
      ),
    )
    yield* SubscriptionRef.set(state, next)
  }, lock.withPermit)

  const report = (next: State) => SubscriptionRef.set(state, next)

  const status: Interface = { state, refresh, report }
  return status
})
