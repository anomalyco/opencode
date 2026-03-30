import { Effect, ScopedCache, Scope } from "effect"
import { Instance, type InstanceContext } from "@/project/instance"
import { registerDisposer } from "./instance-registry"

const TypeId = "~opencode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export namespace InstanceState {
  export const make = <A, E = never, R = never>(
    init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
  ): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const cache = yield* ScopedCache.make<string, A, E, R>({
        capacity: Number.POSITIVE_INFINITY,
        lookup: () => init(Instance.current),
      })

      const off = registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))
      yield* Effect.addFinalizer(() => Effect.sync(off))

      return {
        [TypeId]: TypeId,
        cache,
      }
    })

  export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.get(self.cache, Instance.directory))

  export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) =>
    Effect.map(get(self), select)

  export const useEffect = <A, E, R, B, E2, R2>(
    self: InstanceState<A, E, R>,
    select: (value: A) => Effect.Effect<B, E2, R2>,
  ) => Effect.flatMap(get(self), select)

  export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.has(self.cache, Instance.directory))

  export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
    Effect.suspend(() => ScopedCache.invalidate(self.cache, Instance.directory))
}
