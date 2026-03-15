import { Effect, ScopedCache, Scope } from "effect"

import { Instance } from "@/project/instance"

type Disposer = (directory: string) => Effect.Effect<void>
const disposers = new Set<Disposer>()

const TypeId = "~opencode/InstanceState"

/**
 * Effect version of `Instance.state` — lazily-initialized, per-directory
 * cached state for Effect services.
 *
 * Values are created on first access for a given directory and cached for
 * subsequent reads. Concurrent access shares a single initialization —
 * no duplicate work or races. Use `Effect.acquireRelease` in `init` if
 * the value needs cleanup on disposal.
 */
export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export namespace InstanceState {
  /** Create a new InstanceState with the given initializer. */
  export const make = <A, E = never, R = never>(
    init: (directory: string) => Effect.Effect<A, E, R | Scope.Scope>,
  ): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const cache = yield* ScopedCache.make<string, A, E, R>({
        capacity: Number.POSITIVE_INFINITY,
        lookup: init,
      })

      const disposer: Disposer = (directory) => ScopedCache.invalidate(cache, directory)
      disposers.add(disposer)
      yield* Effect.addFinalizer(() => Effect.sync(() => void disposers.delete(disposer)))

      return {
        [TypeId]: TypeId,
        cache,
      }
    })

  /** Get the cached value for the current directory, initializing it if needed. */
  export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.get(self.cache, Instance.directory))

  /** Check whether a value exists for the current directory. */
  export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.has(self.cache, Instance.directory))

  /** Invalidate the cached value for the current directory. */
  export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.invalidate(self.cache, Instance.directory))

  /** Invalidate the given directory across all InstanceState caches. */
  export const dispose = (directory: string) =>
    Effect.all(
      [...disposers].map((disposer) => disposer(directory)),
      { concurrency: "unbounded" },
    )
}
