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

type Commit = () => Effect.Effect<Effect.Effect<void>>

type Batch = {
  active: boolean
  readonly flush: boolean
  readonly commits: Set<Commit>
}

const CurrentBatch = Context.Reference<Batch | undefined>("@opencode/State/CurrentBatch", {
  defaultValue: () => undefined,
})
const reloadDebounce = 500

/** flush: false is terminal teardown: states whose transforms are removed stop rebuilding, including pending reloads. */
export function batch<A, E, R>(effect: Effect.Effect<A, E, R>, options: { readonly flush?: boolean } = {}) {
  return Effect.gen(function* () {
    const current = yield* CurrentBatch
    if (current?.active && options.flush !== false) return yield* effect
    const batch: Batch = { active: true, flush: options.flush !== false, commits: new Set() }
    const exit = yield* effect.pipe(Effect.provideService(CurrentBatch, batch), Effect.exit)
    batch.active = false
    if (batch.flush) {
      const notifications = yield* Effect.forEach(batch.commits, (commit) => commit())
      yield* Effect.forEach(notifications, (notify) => notify, { discard: true })
    }
    return yield* exit
  })
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
  /** Runs after the rebuilt state becomes visible while mutation coordination is held. */
  readonly finalize?: (draft: DraftApi) => Effect.Effect<void>
  /** Runs after the rebuilt state is finalized and mutation coordination is released. */
  readonly notify?: (draft: DraftApi) => Effect.Effect<void>
}

export interface Interface<State, DraftApi> extends Transformable<DraftApi> {
  readonly get: () => State
}

export function create<State, DraftApi>(options: Options<State, DraftApi>): Interface<State, DraftApi> {
  let state = options.initial()
  let transforms: { run: TransformCallback<DraftApi> }[] = []
  let generation = 0
  let requestedAt = 0
  let running = false
  let closed = false
  let waiters: { generation: number; done: Deferred.Deferred<void> }[] = []
  const semaphore = Semaphore.makeUnsafe(1)

  const commit = Effect.fn("State.commit")(function* (next: State) {
    state = next
    const draft = options.draft(next)
    if (options.finalize) yield* options.finalize(draft)
    const notify = options.notify
    return notify ? Effect.suspend(() => notify(draft)) : Effect.void
  })

  const materialize = Effect.fnUntraced(function* () {
    if (closed) return Effect.void
    const next = options.initial()
    const api = options.draft(next)
    for (const transform of transforms) {
      yield* Effect.sync(() => {
        transform.run(api)
      })
    }
    return yield* commit(next)
  })

  const materializeCommit = () => semaphore.withPermit(materialize())
  const materializeReload = () => materializeCommit().pipe(Effect.flatMap((notify) => notify))

  const rebuild = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const remaining = requestedAt + reloadDebounce - clock.currentTimeMillisUnsafe()
      if (remaining > 0) yield* Effect.sleep(remaining)
      if (clock.currentTimeMillisUnsafe() < requestedAt + reloadDebounce) return yield* rebuild()

      const target = generation
      const committed = yield* materializeCommit().pipe(Effect.exit)
      const completed = waiters.filter((waiter) => waiter.generation <= target)
      waiters = waiters.filter((waiter) => waiter.generation > target)
      running = false
      if (generation > target) {
        running = true
        yield* rebuild().pipe(Effect.forkDetach)
      }
      const exit = Exit.isFailure(committed) ? committed : yield* committed.value.pipe(Effect.exit)
      yield* Effect.forEach(completed, (waiter) => Deferred.done(waiter.done, exit), {
        concurrency: "unbounded",
        discard: true,
      })
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
    yield* Deferred.await(done)
  })

  return {
    get: () => state,
    transform: Effect.fn("State.transform")(function* (update) {
      yield* Effect.annotateCurrentSpan("state", options.name ?? "anonymous")
      const scope = yield* Scope.Scope
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const transform = { run: update }
          let active = true
          const dispose = Effect.uninterruptible(
            semaphore
              .withPermit(
                Effect.suspend(() => {
                  if (!active) return Effect.succeed(Effect.void)
                  active = false
                  transforms = transforms.filter((item) => item !== transform)
                  return Effect.gen(function* () {
                    const batch = yield* CurrentBatch
                    if (batch?.active) {
                      // Detached debounced reloads must also stay quiet after teardown.
                      if (!batch.flush) {
                        closed = true
                        return Effect.void
                      }
                      batch.commits.add(materializeCommit)
                      return Effect.void
                    }
                    return yield* materialize()
                  })
                }),
              )
              .pipe(Effect.flatMap((notify) => notify)),
          )
          yield* semaphore.withPermit(
            Effect.sync(() => {
              transforms = [...transforms, transform]
            }),
          )
          yield* Scope.addFinalizer(scope, dispose)
          const batch = yield* CurrentBatch
          if (batch?.active) batch.commits.add(materializeCommit)
          else yield* materializeReload()
          return { dispose }
        }),
      )
    }),
    reload,
  }
}
