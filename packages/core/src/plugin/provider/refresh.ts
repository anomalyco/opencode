export * as ProviderRefresh from "./refresh.js"

import { Effect, Exit, Scope, Semaphore, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Provider } from "../../provider.js"

/** Runs `effect` each time the active credential of `integrationID` switches, until the scope closes. */
export const onSwitch = <E, R>(integrationID: string, effect: Effect.Effect<unknown, E, R>) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => effect),
      Effect.forkScoped({ startImmediately: true }),
    )
  })

/** Runs `reload` when `load` reports that the derived state changed. */
export const reloadIfChanged = <E, R>(load: Effect.Effect<boolean, E, R>, reload: Effect.Effect<void>) =>
  load.pipe(Effect.flatMap((changed) => (changed ? reload : Effect.void)))

export interface Selection<R> {
  /** Everything the selection's sources depend on, such as the connection, its secret's fingerprint and settings. */
  readonly key: string
  /**
   * Acquires the selection's sources and subscribes to them, without waiting for them. `current()` stays true while
   * this is the held selection: check it before applying a value, in the same synchronous step that applies it.
   */
  readonly acquire: (current: () => boolean) => Effect.Effect<void, never, Scope.Scope | R>
}

/**
 * Holds the sources an integration's active account needs. `select` reads local state only, such as the active
 * connection, its stored credential and provider settings. It runs now, on every account switch, whenever providers
 * change and on `reselect`. A selection with the held key changes nothing; a new one acquires its sources before the
 * previous selection releases its own, so the sources both share keep their values.
 */
export const follow = Effect.fnUntraced(function* <R>(input: {
  readonly integrationID: string
  readonly select: Effect.Effect<Selection<R>, never, R>
}) {
  const bus = yield* Bus.Service
  const parent = yield* Scope.Scope
  const lock = Semaphore.makeUnsafe(1)
  const hold = yield* holder()
  const update = lock.withPermit(input.select.pipe(Effect.flatMap(hold)))
  yield* update
  yield* onSwitch(input.integrationID, update)
  yield* bus.subscribe(Provider.Event.Updated).pipe(
    Stream.runForEach(() => update),
    Effect.forkScoped({ startImmediately: true }),
  )
  return {
    update,
    // Forked, so a subscriber of the held selection can ask without closing its own scope under itself.
    reselect: update.pipe(Effect.forkIn(parent), Effect.asVoid),
  }
})

/**
 * Holds one selection's scoped resources until the scope closes. A selection with the held key changes nothing; a new
 * one acquires before the previous one releases, so the sources both share keep their values. Callers serialize it.
 */
export const holder = Effect.fnUntraced(function* () {
  const parent = yield* Scope.Scope
  const held: { key?: string; scope?: Scope.Closeable; token?: object } = {}
  return Effect.fnUntraced(function* <R>(next: Selection<R>) {
    if (held.scope && held.key === next.key) return
    const previous = held.scope
    const token = {}
    const scope = yield* Scope.fork(parent)
    Object.assign(held, { key: next.key, scope, token })
    yield* next.acquire(() => held.token === token).pipe(Scope.provide(scope))
    if (previous) yield* Scope.close(previous, Exit.void)
  })
})
