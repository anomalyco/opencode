import { Effect, Fiber, ScopedCache, Scope, Context } from "effect"
import * as EffectLogger from "./logger"
import { Instance, type InstanceContext } from "@/project/instance"
import { LocalContext } from "@/util"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"
import { WorkspaceContext } from "@/control-plane/workspace-context"

const TypeId = "~opencode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const bind = <F extends (...args: any[]) => any>(fn: F): F => {
  try {
    return Instance.bind(fn)
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
  }
  const fiber = Fiber.getCurrent()
  const ctx = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
  if (!ctx) return fn
  return ((...args: any[]) => Instance.restore(ctx, () => fn(...args))) as F
}

export const context = Effect.gen(function* () {
  return (yield* InstanceRef) ?? Instance.current
})

export const workspaceID = Effect.gen(function* () {
  return (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
})

export const directory = Effect.map(context, (ctx) => ctx.directory)

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const cache = yield* ScopedCache.make<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          return yield* init(yield* context)
        }),
    })

    const off = registerDisposer((directory) =>
      Effect.runPromise(ScopedCache.invalidate(cache, directory).pipe(Effect.provide(EffectLogger.layer))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(off))

    return {
      [TypeId]: TypeId,
      cache,
    }
  })

export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.get(self.cache, yield* directory)
  })

export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select)

export const useEffect = <A, E, R, B, E2, R2>(
  self: InstanceState<A, E, R>,
  select: (value: A) => Effect.Effect<B, E2, R2>,
) => Effect.flatMap(get(self), select)

export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.has(self.cache, yield* directory)
  })

export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.invalidate(self.cache, yield* directory)
  })

const instanceStateRefs = {
  bind,
  context,
  workspaceID,
  directory,
  make,
  get,
  use,
  useEffect,
  has,
  invalidate,
}

export namespace InstanceState {
  export type InstanceState<A, E = never, R = never> = import("./instance-state").InstanceState<A, E, R>
  export const bind = (...args: Parameters<typeof import("./instance-state").bind>) => instanceStateRefs.bind(...args)
  export const context = instanceStateRefs.context
  export const workspaceID = instanceStateRefs.workspaceID
  export const directory = instanceStateRefs.directory
  export const make = <A, E = never, R = never>(...args: Parameters<typeof import("./instance-state").make<A, E, R>>) =>
    instanceStateRefs.make<A, E, R>(...args)
  export const get = <A, E, R>(...args: Parameters<typeof import("./instance-state").get<A, E, R>>) =>
    instanceStateRefs.get(...args)
  export const use = <A, E, R, B>(...args: Parameters<typeof import("./instance-state").use<A, E, R, B>>) =>
    instanceStateRefs.use(...args)
  export const useEffect = <A, E, R, B, E2, R2>(
    ...args: Parameters<typeof import("./instance-state").useEffect<A, E, R, B, E2, R2>>
  ) => instanceStateRefs.useEffect(...args)
  export const has = <A, E, R>(...args: Parameters<typeof import("./instance-state").has<A, E, R>>) =>
    instanceStateRefs.has(...args)
  export const invalidate = <A, E, R>(...args: Parameters<typeof import("./instance-state").invalidate<A, E, R>>) =>
    instanceStateRefs.invalidate(...args)
}
