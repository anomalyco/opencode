export * as State from "./state.js"

import { Cause, Context, Effect, Exit, Fiber, Scope } from "effect"

/**
 * A synchronous, replayable edit to the current domain state.
 *
 * Domain editors expose readable and writable state while preserving concise
 * plugin/config code. Transforms synchronously rebuild derived state.
 */
type TransformCallback<Editor> = (editor: Editor) => void
export type MakeEditor<State, Editor> = (state: State) => Editor

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

/**
 * Registers a scoped transform. Reads rebuild by applying every registered transform in order.
 * Closing the owning Scope removes the transform and invalidates the current value.
 */
export type Transform<Editor> = (
  transform: TransformCallback<Editor>,
) => Effect.Effect<Registration, never, Scope.Scope>

/** Invalidates the current value after captured inputs change and notifies like a registration would. */
export type Reload = () => Effect.Effect<void>

export interface Transformable<Editor> {
  readonly transform: Transform<Editor>
  readonly reload: Reload
}

export interface Failure {
  readonly state: string
  readonly cause: unknown
}

type OwnedRegistration = {
  readonly remove: () => boolean
  readonly notify: Effect.Effect<void>
}

type Owner = {
  failed: boolean
  readonly registrations: Set<OwnedRegistration>
  readonly report: (failure: Failure, refresh: Effect.Effect<void>) => void
}

const CurrentOwner = Context.Reference<Owner | undefined>("@opencode/State/CurrentOwner", {
  defaultValue: () => undefined,
})

/**
 * Groups registrations without coupling State to plugin identity or asynchronous cleanup.
 * A failed owner is detached synchronously; its supervisor must run refresh and close its scope.
 */
export function owner(report: Owner["report"]) {
  const owner: Owner = { failed: false, registrations: new Set(), report }
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentOwner, owner)
}

function quarantine(owner: Owner, failure: Failure) {
  if (owner.failed) return
  owner.failed = true
  const notifications = new Set<Effect.Effect<void>>()
  for (const registration of owner.registrations) {
    registration.remove()
    notifications.add(registration.notify)
  }
  owner.report(
    failure,
    Effect.forEach(notifications, (notify) => notify, { discard: true }),
  )
}

type Batch = {
  active: boolean
  readonly shutdown: boolean
  readonly notifications: Set<Effect.Effect<void>>
}

const CurrentBatch = Context.Reference<Batch | undefined>("@opencode/State/CurrentBatch", {
  defaultValue: () => undefined,
})
/** Coalesces notifications until the effect completes. Reads inside stay fresh; nothing is rolled back. */
export function batch<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return run(effect, false)
}

/** Runs the effect as shutdown: States changed inside it close permanently and never notify again. */
export function shutdown<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return run(effect, true)
}

function run<A, E, R>(effect: Effect.Effect<A, E, R>, shutdown: boolean) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = yield* CurrentBatch
      if (current?.active && !shutdown) return yield* restore(effect)
      const batch: Batch = { active: true, shutdown, notifications: new Set() }
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatch, batch))).pipe(Effect.exit)
      batch.active = false
      // A shutdown batch never collects notifications: changed() closes the State instead.
      const notifications = yield* Effect.forEach(batch.notifications, (notify) => restore(notify).pipe(Effect.exit))
      // Aggregate ordinary failures across domains, while allowing cancellation to stop observer work.
      yield* Exit.asVoidAll([exit, ...notifications])
      return yield* exit
    }),
  )
}

/**
 * A `notify` body that runs resource reconciliation in the owning layer's FiberSet and awaits it, so work
 * queued behind the layer's locks is interrupted with the layer. That interruption is not a failure.
 */
export function reconcile(
  root: Scope.Scope,
  fork: (effect: Effect.Effect<void>) => Fiber.Fiber<void>,
  work: () => Effect.Effect<void>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const exit = yield* Fiber.await(fork(work()))
    if (Exit.isFailure(exit) && root.state._tag === "Closed" && Cause.hasInterruptsOnly(exit.cause)) return
    yield* exit
  })
}

export const inherit = Effect.fnUntraced(function* () {
  const batch = yield* CurrentBatch
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentBatch, batch)
})

export interface Options<State, Editor> {
  readonly name?: string
  /** Creates the empty base value for every rebuild. */
  readonly initial: () => State
  /** Wraps mutable state in a domain-specific editor API. */
  readonly editor: MakeEditor<State, Editor>
  /**
   * Observes the freshly rebuilt value outside the read path. Every registration, disposal, or
   * reload notifies once it is applied; a batch coalesces them into one notification at its end.
   * Resource reconciliation owns its execution scope and coordination.
   */
  readonly notify?: (state: State) => Effect.Effect<void>
}

export interface Interface<State, Editor> extends Transformable<Editor> {
  /**
   * Rebuilds synchronously when transforms changed since the last read. Each rebuild produces a new
   * value and never touches earlier ones, so callers may retain what they read.
   */
  readonly get: () => State
}

export function create<State, Editor>(options: Options<State, Editor>): Interface<State, Editor> {
  let state = options.initial()
  const transforms = new Set<{ run: TransformCallback<Editor>; owner: Owner | undefined }>()
  let dirty = false
  let closed = false
  let version = 0

  const invalidate = () => {
    dirty = true
    version++
  }

  const get = () => {
    if (closed || !dirty) return state
    while (true) {
      const started = version
      const next = options.initial()
      const editor = options.editor(next)
      for (const transform of transforms) {
        try {
          transform.run(editor)
        } catch (cause) {
          if (!transform.owner) throw cause
          quarantine(transform.owner, { state: options.name ?? "anonymous", cause })
        }
        // A nested read can quarantine an owner that already contributed to this candidate.
        if (version !== started) break
      }
      if (version !== started) continue
      // Unowned failures still propagate; owned failures restart from a fresh candidate.
      state = next
      dirty = false
      return state
    }
  }

  // One stable value per State, so a batch's notification Set holds it at most once.
  const notify: Effect.Effect<void> = Effect.gen(function* () {
    if (closed) return
    const value = get()
    if (options.notify) yield* options.notify(value)
  }).pipe(Effect.withSpan("State.notify"))

  const changed = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (closed) return
      invalidate()
      const batch = yield* CurrentBatch
      if (batch?.active) {
        if (batch.shutdown) {
          closed = true
          return
        }
        batch.notifications.add(notify)
        return
      }
      yield* restore(notify)
    }),
  )

  return {
    get,
    transform: Effect.fn("State.transform")(function* (update) {
      yield* Effect.annotateCurrentSpan("state", options.name ?? "anonymous")
      const scope = yield* Scope.Scope
      const owner = yield* CurrentOwner
      if (owner?.failed) return { dispose: Effect.void }
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const transform = { run: update, owner }
          const registration: OwnedRegistration = {
            remove: () => {
              if (!transforms.delete(transform)) return false
              owner?.registrations.delete(registration)
              invalidate()
              return true
            },
            notify: changed,
          }
          const dispose = Effect.uninterruptible(Effect.suspend(() => (registration.remove() ? changed : Effect.void)))
          transforms.add(transform)
          owner?.registrations.add(registration)
          yield* Scope.addFinalizer(scope, dispose)
          yield* changed
          return { dispose }
        }),
      )
    }),
    reload: () => changed,
  }
}
