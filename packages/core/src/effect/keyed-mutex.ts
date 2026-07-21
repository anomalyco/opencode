export * as KeyedMutex from "./keyed-mutex"

import { Effect, Semaphore } from "effect"

export interface KeyedMutex<in Key> {
  readonly size: Effect.Effect<number>
  readonly withLock: (key: Key) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/**
 * Creates an in-memory mutex with one lock per key. Entries are removed when no
 * holder or waiter remains.
 *
 *   same key      -> queue
 *   different key -> run independently
 *
 * `users` counts holders and waiters so an entry is not removed while a waiter
 * will reuse it.
 */
export const makeUnsafe = <Key>(): KeyedMutex<Key> => {
  const locks = new Map<Key, { readonly semaphore: Semaphore.Semaphore; users: number }>()

  const withLock =
    (key: Key) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        const current = locks.get(key)
        const entry = current ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
        if (!current) locks.set(key, entry)
        entry.users++
        return entry.semaphore.withPermit(effect).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users--
              if (entry.users === 0) locks.delete(key)
            }),
          ),
        )
      })

  return { size: Effect.sync(() => locks.size), withLock }
}

/** Creates an in-memory keyed mutex inside an Effect workflow. */
export const make = <Key>(): Effect.Effect<KeyedMutex<Key>> => Effect.sync(makeUnsafe<Key>)
