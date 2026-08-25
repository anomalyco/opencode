export * as BackgroundServiceState from "./background-service-state"

import { Effect, Exit, Ref } from "effect"
import type { ServerReadyData } from "../../shared/ipc-contract"

export const make = Effect.fn("BackgroundServiceState.make")(function* (options: {
  readonly initial: Effect.Effect<ServerReadyData, unknown>
  readonly reconnect: Effect.Effect<ServerReadyData>
}) {
  // Every Exit is an Effect, so the latest resolution replays directly for each consumer.
  const current = yield* Ref.make<Exit.Exit<ServerReadyData, unknown>>(yield* options.initial.pipe(Effect.exit))
  return {
    connection: Ref.get(current).pipe(Effect.flatten, Effect.orDie),
    reconnect: options.reconnect.pipe(Effect.tap((next) => Ref.set(current, Exit.succeed(next)))),
  }
})
