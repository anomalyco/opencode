export * as BackgroundServiceState from "./background-service-state"

import { Deferred, Effect, Exit, Ref } from "effect"
import type { SidecarCredentials } from "./sidecar-credentials"

// The initial connect runs in the background: windows are created as soon as the main process
// is up, and the renderer loads its bundle while the CLI service is being resolved. Consumers
// await the first outcome through `connection`, so nothing observes the service before it exists.
export const make = Effect.fn("BackgroundServiceState.make")(function* (options: {
  readonly initial: Effect.Effect<SidecarCredentials.Data, unknown>
  readonly reconnect: Effect.Effect<SidecarCredentials.Data>
}) {
  // Every Exit is an Effect, so the latest resolution replays directly for each consumer.
  const current = yield* Ref.make<Exit.Exit<SidecarCredentials.Data, unknown> | undefined>(undefined)
  const first = yield* Deferred.make<void>()
  yield* options.initial.pipe(
    Effect.exit,
    Effect.flatMap((exit) => Ref.set(current, exit)),
    Effect.ensuring(Deferred.succeed(first, undefined)),
    Effect.forkScoped,
  )
  return {
    connection: Deferred.await(first).pipe(
      Effect.flatMap(() => Ref.get(current)),
      Effect.flatMap((exit) => exit ?? Exit.die(new Error("background service connect did not resolve"))),
      Effect.orDie,
    ),
    reconnect: options.reconnect.pipe(Effect.tap((next) => Ref.set(current, Exit.succeed(next)))),
  }
})
