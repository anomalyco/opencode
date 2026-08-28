export * as State from "./state.js"

import { Clock, Context, Deferred, Effect, Exit, Scope } from "effect"

/**
 * A replayable transform applied to a draft while deriving state.
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
 * Registers a scoped transform and invalidates the derived state. Closing the
 * owning Scope removes the transform. Reads synchronously replay pending changes.
 */
export type Transform<DraftApi> = (
  transform: TransformCallback<DraftApi>,
) => Effect.Effect<Registration, never, Scope.Scope>

/** Invalidates the snapshot after captured inputs change and coalesces notifications. */
export type Reload = () => Effect.Effect<void>

export interface Transformable<DraftApi> {
  readonly transform: Transform<DraftApi>
  readonly reload: Reload
}

type Batch = {
  active: boolean
  readonly flush: boolean
  readonly notifications: Set<Reload>
}

const CurrentBatch = Context.Reference<Batch | undefined>("@opencode/State/CurrentBatch", {
  defaultValue: () => undefined,
})
const reloadDebounce = 500

/** Batches notifications, not read visibility. flush: false is terminal teardown. */
export function batch<A, E, R>(effect: Effect.Effect<A, E, R>, options: { readonly flush?: boolean } = {}) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = yield* CurrentBatch
      if (current?.active && options.flush !== false) return yield* restore(effect)
      const batch: Batch = { active: true, flush: options.flush !== false, notifications: new Set() }
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatch, batch))).pipe(Effect.exit)
      batch.active = false
      const notifications = batch.flush
        ? yield* Effect.forEach(batch.notifications, (notify) => restore(notify()).pipe(Effect.exit))
        : []
      // Accepted writes are not rolled back: one failed observer must not hide
      // the other states' changes, or replace the batch body's failure.
      yield* Exit.asVoidAll([exit, ...notifications])
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
  /** Synchronously completes derived data after ordered transform replay. */
  readonly prepare?: (state: State) => void
  /**
   * Observes accepted changes outside the read path. Batched writes notify at
   * batch completion; reloads debounce notifications. Reads never run this hook.
   * Resource reconciliation owns its execution scope and coordination.
   */
  readonly notify?: () => Effect.Effect<void>
}

export interface Interface<State, DraftApi> extends Transformable<DraftApi> {
  /** Returns the latest accepted state, replaying stale inputs synchronously. */
  readonly get: () => State
}

export function create<State, DraftApi>(options: Options<State, DraftApi>): Interface<State, DraftApi> {
  let state = options.initial()
  const transforms = new Set<{ run: TransformCallback<DraftApi> }>()
  let dirty = false
  let requestedAt = 0
  let closed = false
  let pending: Deferred.Deferred<void> | undefined

  const get = () => {
    if (!dirty || closed) return state
    const next = options.initial()
    const api = options.draft(next)
    transforms.forEach((transform) => transform.run(api))
    options.prepare?.(next)
    state = next
    dirty = false
    return state
  }

  const notify = Effect.fn("State.notify")(function* () {
    if (closed) return
    get()
    if (options.notify) yield* options.notify()
  })

  const publish = (done: Deferred.Deferred<void>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const remaining = requestedAt + reloadDebounce - clock.currentTimeMillisUnsafe()
      if (remaining > 0) yield* Effect.sleep(remaining)
      if (clock.currentTimeMillisUnsafe() < requestedAt + reloadDebounce) return yield* publish(done)

      // Release scheduling ownership before observers run: an observer may
      // request and await another reload without joining this notification.
      pending = undefined
      yield* notify().pipe(Deferred.into(done))
    })

  const changed = (debounce: boolean) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (closed) return
        if (debounce) dirty = true
        const batch = yield* CurrentBatch
        if (batch?.active) {
          if (!batch.flush) {
            closed = true
            return
          }
          batch.notifications.add(notify)
          return
        }
        if (!debounce) return yield* restore(notify())

        const clock = yield* Clock.Clock
        requestedAt = clock.currentTimeMillisUnsafe()
        // No yields between choosing the burst's completion and claiming it.
        const done = pending ?? Deferred.makeUnsafe<void>()
        if (!pending) {
          pending = done
          yield* publish(done).pipe(Effect.forkDetach)
        }
        yield* restore(Deferred.await(done))
      }),
    )

  return {
    get,
    transform: Effect.fn("State.transform")(function* (update) {
      yield* Effect.annotateCurrentSpan("state", options.name ?? "anonymous")
      const scope = yield* Scope.Scope
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const transform = { run: update }
          const dispose = Effect.uninterruptible(
            Effect.suspend(() => {
              if (!transforms.delete(transform)) return Effect.void
              dirty = true
              return changed(false)
            }),
          )
          transforms.add(transform)
          dirty = true
          yield* Scope.addFinalizer(scope, dispose)
          yield* changed(false)
          return { dispose }
        }),
      )
    }),
    reload: () => changed(true),
  }
}
