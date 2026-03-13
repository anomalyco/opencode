import { Effect, ScopedCache, Scope } from "effect"

import { Instance } from "@/project/instance"

const TypeId = Symbol.for("@opencode/InstanceState")

type Task = (key: string) => Effect.Effect<void>

const tasks = new Set<Task>()

export namespace InstanceState {
  export interface State<A, E = never, R = never> {
    readonly [TypeId]: typeof TypeId
    readonly cache: ScopedCache.ScopedCache<string, A, E, R>
  }

  export const make = <A, E = never, R = never>(input: {
    lookup: (key: string) => Effect.Effect<A, E, R>
    release?: (value: A, key: string) => Effect.Effect<void>
  }): Effect.Effect<State<A, E, R>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const cache = yield* ScopedCache.make<string, A, E, R>({
        capacity: Number.POSITIVE_INFINITY,
        lookup: (key) =>
          Effect.acquireRelease(input.lookup(key), (value) =>
            input.release ? input.release(value, key) : Effect.void,
          ),
      })

      const task: Task = (key) => ScopedCache.invalidate(cache, key)
      tasks.add(task)
      yield* Effect.addFinalizer(() => Effect.sync(() => void tasks.delete(task)))

      return {
        [TypeId]: TypeId,
        cache,
      }
    })

  export const get = <A, E, R>(self: State<A, E, R>) => ScopedCache.get(self.cache, Instance.directory)

  export const has = <A, E, R>(self: State<A, E, R>) => ScopedCache.has(self.cache, Instance.directory)

  export const invalidate = <A, E, R>(self: State<A, E, R>) => ScopedCache.invalidate(self.cache, Instance.directory)

  export const dispose = (key: string) =>
    Effect.all(
      [...tasks].map((task) => task(key)),
      { concurrency: "unbounded" },
    )
}
