export * as BackgroundServiceState from "./background-service-state"

import { Effect, Exit, Ref } from "effect"
import type { SidecarCredentials } from "./sidecar-credentials"

export const make = Effect.fn("BackgroundServiceState.make")(function* (options: {
  readonly initial: Effect.Effect<SidecarCredentials.Data, unknown>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}) {
  // Every Exit is an Effect, so the latest resolution replays directly for each consumer.
  const current = yield* Ref.make<Exit.Exit<SidecarCredentials.Data, unknown>>(yield* options.initial.pipe(Effect.exit))
  return {
    connection: Ref.get(current).pipe(Effect.flatten, Effect.orDie),
    reconnect: options.reconnect.pipe(Effect.tap((next) => Ref.set(current, Exit.succeed(next)))),
  }
})
