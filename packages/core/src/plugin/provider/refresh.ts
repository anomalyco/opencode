export * as ProviderRefresh from "./refresh.js"

import { Duration, Effect, Equal, Fiber, FiberHandle, Scope, Semaphore, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { SharedCache } from "../../shared-cache.js"

type Connection = Parameters<typeof IntegrationConnection.key>[0]

/** How a load asks `SharedCache.get` for its list. */
export type Options = { readonly interval?: Duration.Input; readonly force?: boolean }

/**
 * After an account switch, applies the account's list from the cache at once, however old, while a forced load runs
 * alongside and is applied when it finishes. With nothing cached the first step joins the forced load, so one request
 * serves both; after a failed load the forced load is the retry.
 */
export const switched = <A>(load: (options: Options) => Effect.Effect<A>, apply: (next: A) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const fresh = yield* load({ force: true }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* load({ interval: Duration.infinity }).pipe(Effect.flatMap(apply))
    yield* Fiber.join(fresh).pipe(Effect.flatMap(apply))
  })

/**
 * Keeps a Location's copy of a provider's shared list current: loads in the background at startup, on an account
 * switch (see `switched`) and every `interval`, and reloads providers only when the value changed. `load` passes the
 * options it gets to `SharedCache.get`. A switch replaces a waiting load. A value loaded for a connection that is no
 * longer active is dropped.
 */
export const start = Effect.fnUntraced(function* <A>(input: {
  readonly integrationID: string
  readonly initial: A
  readonly interval?: Duration.Input
  readonly active: Effect.Effect<Connection>
  readonly load: (current: A, options: Options) => Effect.Effect<{ readonly connection: Connection; readonly value: A }>
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
  const load = (options: Options) => Effect.suspend(() => input.load(state.current, { interval, ...options }))
  const refresh = load({}).pipe(Effect.flatMap(apply))
  yield* bus.subscribe(Credential.Event.Switched).pipe(
    Stream.filter((event) => event.data.integrationID === input.integrationID),
    Stream.runForEach(() => FiberHandle.run(loading, switched(load, apply))),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* FiberHandle.run(loading, refresh, { onlyIfMissing: true }).pipe(Effect.forkScoped)
  yield* Effect.sleep(interval).pipe(
    Effect.andThen(FiberHandle.run(loading, refresh, { onlyIfMissing: true })),
    Effect.forever,
    Effect.forkScoped,
  )
  return state
})
