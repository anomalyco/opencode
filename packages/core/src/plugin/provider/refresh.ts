export * as ProviderRefresh from "./refresh.js"

import { Duration, Effect, Equal, FiberHandle, Scope, Semaphore, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { SharedCache } from "../../shared-cache.js"

type Connection = Parameters<typeof IntegrationConnection.key>[0]

/**
 * Keeps a Location's copy of a provider's shared list current: loads in the background at startup, on an account
 * switch and every `interval`, and reloads providers only when the value changed. `load` gets the same interval to
 * pass to `SharedCache.get`. A switch replaces a
 * waiting load. A value loaded for a connection that is no longer active is dropped.
 */
export const start = Effect.fnUntraced(function* <A>(input: {
  readonly integrationID: string
  readonly initial: A
  readonly interval?: Duration.Input
  readonly active: Effect.Effect<Connection>
  readonly load: (
    current: A,
    interval: Duration.Input,
  ) => Effect.Effect<{ readonly connection: Connection; readonly value: A }>
  readonly reload: Effect.Effect<void>
}): Effect.fn.Return<{ readonly current: A }, never, Bus.Service | Scope.Scope> {
  const bus = yield* Bus.Service
  const interval = input.interval ?? SharedCache.interval
  const lock = Semaphore.makeUnsafe(1)
  const loading = yield* FiberHandle.make<void, never>()
  const state = { current: input.initial }
  const apply = (next: { readonly connection: Connection; readonly value: A }) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          if (IntegrationConnection.key(next.connection) !== IntegrationConnection.key(yield* input.active)) return
          if (Equal.equals(next.value, state.current)) return
          state.current = next.value
          yield* input.reload
        }),
      )
      .pipe(Effect.uninterruptible)
  const refresh = (replace: boolean) =>
    FiberHandle.run(loading, Effect.suspend(() => input.load(state.current, interval)).pipe(Effect.flatMap(apply)), {
      onlyIfMissing: !replace,
    })
  yield* bus.subscribe(Credential.Event.Switched).pipe(
    Stream.filter((event) => event.data.integrationID === input.integrationID),
    Stream.runForEach(() => refresh(true)),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* refresh(false).pipe(Effect.forkScoped)
  yield* Effect.sleep(interval).pipe(Effect.andThen(refresh(false)), Effect.forever, Effect.forkScoped)
  return state
})
