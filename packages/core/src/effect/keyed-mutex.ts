export * as KeyedMutex from "./keyed-mutex.js"

import { Duration, Effect, Semaphore } from "effect"

export interface KeyedMutex<in Key> {
  readonly size: Effect.Effect<number>
  readonly withLock: (
    key: Key,
    options?: { readonly timeout?: string },
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
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
 *
 * When `options.timeout` is set, lock acquisition fails after the given duration
 * instead of waiting forever. A timed-out waiter is removed from the entry's
 * user count so subsequent acquisitions are not blocked.
 */
export const makeUnsafe = <Key>(): KeyedMutex<Key> => {
  const locks = new Map<Key, { readonly semaphore: Semaphore.Semaphore; users: number }>()

  const withLock =
    (key: Key, options?: { readonly timeout?: string }) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.suspend(() => {
        const current = locks.get(key)
        const entry = current ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 }
        if (!current) locks.set(key, entry)
        entry.users++
        const acquire = entry.semaphore.withPermit(effect)
        const timed = options?.timeout
          ? Effect.timeout(acquire, options.timeout as Duration.Input)
          : acquire
        return timed.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users--
              if (entry.users === 0) locks.delete(key)
            }),
          ),
        ) as Effect.Effect<A, E, R>
      })

  return { size: Effect.sync(() => locks.size), withLock }
}

/** Creates an in-memory keyed mutex inside an Effect workflow. */
export const make = <Key>(): Effect.Effect<KeyedMutex<Key>> => Effect.sync(makeUnsafe<Key>)
