export * as Preferences from "./preferences.js"
export { Target, State, Entry, Event } from "@opencode-ai/schema/preferences"

import { Preferences } from "@opencode-ai/schema/preferences"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"

const prefix = "preferences:activation:"
const key = (target: Preferences.Target) => `${prefix}${JSON.stringify([target.kind, target.id])}`
const decode = Schema.decodeUnknownOption(Preferences.Entry)

/** Global activation overrides. Consumers own defaults, inventory, and the meaning of activation. */
export interface Interface {
  readonly get: (target: Preferences.Target) => Effect.Effect<Preferences.State | undefined>
  readonly list: () => Effect.Effect<Preferences.Entry[]>
  readonly set: (target: Preferences.Target, state: Preferences.State) => Effect.Effect<void>
  readonly reset: (target: Preferences.Target) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Preferences") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const bus = yield* Bus.Service

    return Service.of({
      get: Effect.fn("Preferences.get")(function* (target) {
        return Option.getOrUndefined(decode(yield* kv.get(key(target))))?.state
      }),
      list: Effect.fn("Preferences.list")(function* () {
        const entries: Preferences.Entry[] = []
        let after: string | undefined
        do {
          const page = yield* kv.scan({ prefix, after, limit: 1000 })
          entries.push(...page.entries.flatMap((entry) => Option.toArray(decode(entry.value))))
          after = page.next
        } while (after !== undefined)
        return entries
      }),
      set: Effect.fn("Preferences.set")(function* (target, state) {
        yield* kv.set(key(target), { target, state })
        yield* bus.publish(Preferences.Event.Updated, { target }, { global: true })
      }),
      reset: Effect.fn("Preferences.reset")(function* (target) {
        yield* kv.remove(key(target))
        yield* bus.publish(Preferences.Event.Updated, { target }, { global: true })
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Bus.node] })
