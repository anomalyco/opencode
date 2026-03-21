import { Effect, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"

export const memoMap = Layer.makeMemoMapUnsafe()

export function makeRunPromise<I, S, E>(service: ServiceMap.Service<I, S>, layer: Layer.Layer<I, E>) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined

  return <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) => {
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runPromise(service.use(fn), options)
  }
}
