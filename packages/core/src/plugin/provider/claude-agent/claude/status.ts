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
  /** The state once checked: waits for a check already running, or runs one if none has finished yet. */
  readonly settled: () => Effect.Effect<State>
  // What a chat's own process found when it started
  readonly report: (next: State) => Effect.Effect<void>
}

export const make = Effect.fn("ClaudeStatus.make")(function* (
  io: ClaudeIO.Interface,
  connection: () => Effect.Effect<Record<string, string>>,
) {
  const state = yield* SubscriptionRef.make<State>({ type: "checking" })
  const lock = yield* Semaphore.make(1)

  const check = Effect.fn("ClaudeStatus.check")(function* () {
    const executable = io.which()
    if (!executable) return yield* SubscriptionRef.set(state, { type: "missing" })
    const env = yield* connection()
    const next = yield* ClaudeProbe.run(ClaudeQueryOptions.base({ executable, io, connection: env })).pipe(
      Effect.map((probe): State => ({ type: "ready", probe })),
      Effect.catch((error) =>
        Effect.logWarning("Claude Code login check failed", { cause: error.cause }).pipe(
          Effect.as<State>({
            type: "failed",
            message: error.cause instanceof Error ? error.cause.message : String(error.cause),
          }),
        ),
      ),
    )
    yield* SubscriptionRef.set(state, next)
  })

  // Serialized so a reconnect checks again after startup, rather than racing it with an older account snapshot.
  const refresh = () => lock.withPermit(check())

  const settled = () =>
    lock.withPermit(
      Effect.gen(function* () {
        if ((yield* SubscriptionRef.get(state)).type === "checking") yield* check()
        return yield* SubscriptionRef.get(state)
      }),
    )

  const report = (next: State) => SubscriptionRef.set(state, next)

  return { state, refresh, settled, report } satisfies Interface
})
