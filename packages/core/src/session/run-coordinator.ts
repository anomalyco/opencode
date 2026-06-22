export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const makeEntry = (): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      pendingWake: false,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) => {
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor
          ? Effect.yieldNow
          : Deferred.await(ready)
        ).pipe(
          Effect.andThen(Effect.suspend(() => options.drain(key, force))),
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)
        return
      }

      const successor = entry.pendingWake ? makeEntry() : undefined
      if (successor === undefined) active.delete(key)
      else {
        active.set(key, successor)
        start(key, successor, false, true)
      }
      Deferred.doneUnsafe(entry.done, exit)
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          return restore(Deferred.await(entry.done))
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return restore(Deferred.await(next.done))
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.pendingWake = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        return Fiber.interrupt(entry.owner)
      })

    return { run, wake, interrupt }
  })
