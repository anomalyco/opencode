export * as WebSearchPreference from "./websearch-preference"

import { Context, Effect, Layer, Semaphore } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { KV } from "./kv"

const key = "websearch:provider"

export interface Interface {
  readonly get: () => Effect.Effect<KV.Value | undefined>
  readonly set: (value: KV.Value) => Effect.Effect<void>
  readonly synchronized: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WebSearchPreference") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const lock = Semaphore.makeUnsafe(1)
    return Service.of({
      get: () => kv.get(key),
      set: (value) => kv.set(key, value),
      synchronized: (effect) => lock.withPermit(effect),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
