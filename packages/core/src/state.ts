export * as State from "./state.js"

import { Clock, Context, Deferred, Effect, Exit, Scope, Semaphore } from "effect"

/**
 * A replayable transform applied to a draft during reload.
 *
 * Domain drafts expose readable and writable state while preserving concise
 * plugin/config code. Transforms synchronously rebuild derived state.
 */
type TransformCallback<DraftApi> = (draft: DraftApi) => void
export type MakeDraft<State, DraftApi> = (state: State) => DraftApi

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

/**
 * Registers and applies a scoped transform. Closing the owning Scope removes
 * the transform and reloads the materialized state.
 */
export type Transform<DraftApi> = (
  transform: TransformCallback<DraftApi>,
) => Effect.Effect<Registration, never, Scope.Scope>

export type Reload = () => Effect.Effect<void>

export interface Transformable<DraftApi> {
  readonly transform: Transform<DraftApi>
  readonly reload: Reload
}

type Batch = {
  active: boolean
  readonly flush: boolean
  readonly reloads: Set<Reload>
  readonly done: Deferred.Deferred<void>
}

type Commit = {
  active: boolean
}

const CurrentBatch = Context.Reference<Batch | undefined>("@opencode/State/CurrentBatch", {
  defaultValue: () => undefined,
})
const CurrentCommit = Context.Reference<Commit | undefined>("@opencode/State/CurrentCommit", {
  defaultValue: () => undefined,
})
const reloadDebounce = 500

/** flush: false is terminal teardown: states whose transforms are removed stop rebuilding, including pending reloads. */
export function batch<A, E, R>(effect: Effect.Effect<A, E, R>, options: { readonly flush?: boolean } = {}) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = yield* CurrentBatch
      if (current?.active && options.flush !== false) return yield* restore(effect)
      const batch: Batch = {
        active: true,
        flush: options.flush !== false,
        reloads: new Set(),
        done: Deferred.makeUnsafe<void>(),
      }
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatch, batch))).pipe(Effect.exit)
      batch.active = false
      const reloaded = batch.flush
        ? yield* Effect.forEach(batch.reloads, (reload) => reload().pipe(Effect.exit)).pipe(
            Effect.provideService(CurrentBatch, batch),
          )
        : []
      yield* Deferred.succeed(batch.done, undefined)
      const failure = reloaded.find(Exit.isFailure)
      if (failure) return yield* failure
      return yield* exit
    }),
  )
}

export const inherit = Effect.fnUntraced(function* () {
  const batch = yield* CurrentBatch
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentBatch, batch)
})

export interface Options<State, DraftApi> {
  readonly name?: string
  /** Creates the base value for initial state and every scoped-transform reload. */
  readonly initial: () => State
  /** Wraps mutable state in a domain-specific draft API. */
  readonly draft: MakeDraft<State, DraftApi>
  /**
   * Runs after the rebuilt state becomes visible. Update events published here
   * act as read barriers: subscribers refetching on the event observe the
   * committed state.
   */
  readonly finalize?: (draft: DraftApi) => Effect.Effect<void>
}

export interface Interface<State, DraftApi> extends Transformable<DraftApi> {
  readonly get: () => State
  readonly read: () => Effect.Effect<State>
}

export function create<State, DraftApi>(options: Options<State, DraftApi>): Interface<State, DraftApi> {
  let state = options.initial()
  let transforms: { run: TransformCallback<DraftApi> }[] = []
  let generation = 0
  let reloadedGeneration = 0
  let reloading: Deferred.Deferred<void> | undefined
  let requestedAt = 0
  let running = false
  let closed = false
  let committing = false
  let waiters: { generation: number; done: Deferred.Deferred<void> }[] = []
  const semaphore = Semaphore.makeUnsafe(1)
  const batches = new Set<Batch>()

  const commit = Effect.fn("State.commit")(function* (next: State) {
    state = next
    if (options.finalize) {
      const current: Commit = { active: true }
      committing = true
      yield* options.finalize(options.draft(next)).pipe(
        Effect.provideService(CurrentCommit, current),
        Effect.ensuring(
          Effect.sync(() => {
            current.active = false
            committing = false
          }),
        ),
      )
    }
  })

  const materialize = Effect.fnUntraced(function* () {
    if (closed) return
    const next = options.initial()
    const api = options.draft(next)
    for (const transform of transforms) {
      yield* Effect.sync(() => {
        transform.run(api)
      })
    }
    yield* commit(next)
  })

  const materializeCurrent = Effect.fnUntraced(function* () {
    const target = generation
    const exit = yield* materialize().pipe(Effect.exit)
    if (Exit.isSuccess(exit)) reloadedGeneration = target
    for (const batch of batches) {
      if (!batch.active) batches.delete(batch)
    }
    if (waiters.length) {
      const completed = waiters.filter((waiter) => waiter.generation <= target)
      waiters = waiters.filter((waiter) => waiter.generation > target)
      for (const waiter of completed) Deferred.doneUnsafe(waiter.done, exit)
    }
    return yield* exit
  })
  const materializeReload = () => semaphore.withPermit(materializeCurrent())
  const materializePending = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (reloadedGeneration >= generation) return Effect.void
      if (reloading) return Deferred.await(reloading)

      const done = Deferred.makeUnsafe<void>()
      reloading = done
      return Effect.gen(function* () {
        yield* Effect.forEach(batches, (batch) => Deferred.await(batch.done), { discard: true }).pipe(
          Effect.andThen(
            semaphore.withPermit(
              Effect.suspend(() => {
                if (reloadedGeneration >= generation) return Effect.void
                return materializeCurrent()
              }),
            ),
          ),
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.sync(() => {
              reloading = undefined
              Deferred.doneUnsafe(done, exit)
            }),
          ),
          Effect.forkDetach,
        )
        return yield* Deferred.await(done)
      })
    })

  const rebuild = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const remaining = requestedAt + reloadDebounce - clock.currentTimeMillisUnsafe()
      if (remaining > 0) yield* Effect.sleep(remaining)
      if (clock.currentTimeMillisUnsafe() < requestedAt + reloadDebounce) return yield* rebuild()
      if (reloadedGeneration >= generation || waiters.length === 0) {
        running = false
        return
      }

      const target = generation
      yield* materializePending().pipe(Effect.exit)
      if (generation > target) return yield* rebuild()
      running = false
    })

  const reload = Effect.fnUntraced(function* () {
    if (closed) return
    const done = Deferred.makeUnsafe<void>()
    const clock = yield* Clock.Clock
    generation++
    requestedAt = clock.currentTimeMillisUnsafe()
    waiters.push({ generation, done })
    if (!running) {
      running = true
      yield* rebuild().pipe(Effect.forkDetach)
    }
    return yield* Deferred.await(done)
  })

  return {
    get: () => state,
    read: Effect.fnUntraced(function* () {
      while (reloadedGeneration < generation) {
        if ((yield* CurrentCommit)?.active && committing) return state
        const batch = yield* CurrentBatch
        if (batch?.active || (batch && batches.has(batch))) return state
        yield* materializePending()
      }
      return state
    }),
    transform: Effect.fn("State.transform")(function* (update) {
      yield* Effect.annotateCurrentSpan("state", options.name ?? "anonymous")
      const scope = yield* Scope.Scope
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const transform = { run: update }
          let active = true
          const dispose = Effect.uninterruptible(
            semaphore.withPermit(
              Effect.suspend(() => {
                if (!active) return Effect.void
                active = false
                transforms = transforms.filter((item) => item !== transform)
                return Effect.gen(function* () {
                  const batch = yield* CurrentBatch
                  if (batch?.active) {
                    // Detached debounced reloads must also stay quiet after teardown.
                    if (!batch.flush) {
                      closed = true
                      return
                    }
                    batches.add(batch)
                    batch.reloads.add(materializeReload)
                    return
                  }
                  yield* materializeCurrent()
                })
              }),
            ),
          )
          const batch = yield* CurrentBatch
          if (batch?.active) batches.add(batch)
          yield* semaphore.withPermit(
            Effect.sync(() => {
              transforms = [...transforms, transform]
            }),
          )
          yield* Scope.addFinalizer(scope, dispose)
          if (batch?.active) batch.reloads.add(materializeReload)
          else yield* materializeReload()
          return { dispose }
        }),
      )
    }),
    reload,
  }
}
