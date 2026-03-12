import { Effect, ScopedCache, Scope } from "effect"

const TypeId = Symbol.for("@opencode/ScopedState")

export interface ScopedState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly root: () => string
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const make = <A, E = never, R = never>(input: {
  root: () => string
  lookup: (key: string) => Effect.Effect<A, E, R>
  release?: (value: A, key: string) => Effect.Effect<void>
}): Effect.Effect<ScopedState<A, E, R>, never, Scope.Scope | R> =>
  ScopedCache.make<string, A, E, R>({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (key) =>
      Effect.acquireRelease(input.lookup(key), (value) => (input.release ? input.release(value, key) : Effect.void)),
  }).pipe(
    Effect.map((cache) => ({
      [TypeId]: TypeId,
      root: input.root,
      cache,
    })),
  )

export const get = <A, E, R>(self: ScopedState<A, E, R>) => ScopedCache.get(self.cache, self.root())

export const getAt = <A, E, R>(self: ScopedState<A, E, R>, key: string) => ScopedCache.get(self.cache, key)

export const invalidate = <A, E, R>(self: ScopedState<A, E, R>) => ScopedCache.invalidate(self.cache, self.root())

export const invalidateAt = <A, E, R>(self: ScopedState<A, E, R>, key: string) =>
  ScopedCache.invalidate(self.cache, key)

export const has = <A, E, R>(self: ScopedState<A, E, R>) => ScopedCache.has(self.cache, self.root())

export const hasAt = <A, E, R>(self: ScopedState<A, E, R>, key: string) => ScopedCache.has(self.cache, key)
