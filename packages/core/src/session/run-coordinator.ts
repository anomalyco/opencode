export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Scope } from "effect"

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, A, E> {
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<A, E>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
}

type Entry<A, E> = {
  readonly done: Deferred.Deferred<A, E>
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  stopping: boolean
}

export const make = <Key, A, E>(options: {
  readonly drain: (key: Key, options: { readonly force: boolean }) => Effect.Effect<A, E>
}): Effect.Effect<Coordinator<Key, A, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<A, E>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    let closed = false
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true
        for (const entry of active.values()) Deferred.doneUnsafe(entry.done, Effect.interrupt)
        active.clear()
      }),
    )

    const makeEntry = (): Entry<A, E> => ({
      done: Deferred.makeUnsafe<A, E>(),
      pendingWake: false,
      stopping: false,
    })

    const start = (key: Key, entry: Entry<A, E>, force: boolean, successor = false) => {
      const ready = successor ? undefined : Deferred.makeUnsafe<void>()
      const drain = Effect.suspend(() => options.drain(key, { force }))
      const owner = fork(
        (ready === undefined
          ? Effect.yieldNow.pipe(Effect.andThen(drain))
          : Deferred.await(ready).pipe(Effect.andThen(drain))
        ).pipe(
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (ready !== undefined) Deferred.doneUnsafe(ready, Effect.void)
    }

    const settle = (key: Key, entry: Entry<A, E>, exit: Exit.Exit<A, E>) => {
      if (closed) {
        Deferred.doneUnsafe(entry.done, exit)
        return
      }
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

    const run = (key: Key): Effect.Effect<A, E> =>
      Effect.uninterruptibleMask((restore) => {
        if (closed) return Effect.interrupt
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
        if (closed) return
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
