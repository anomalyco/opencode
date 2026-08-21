export * as Capability from "./capability.js"

import { Capability } from "@opencode-ai/schema/capability"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"

export const Ref = Capability.Ref
export type Ref = Capability.Ref
export const State = Capability.State
export type State = Capability.State
export const Preference = Capability.Preference
export type Preference = Capability.Preference
export const Info = Capability.Info
export type Info = Capability.Info
export const Update = Capability.Update
export type Update = Capability.Update
export const Event = Capability.Event

export const skill = (id: string) => Ref.make({ kind: "skill", key: [id] })

const Key = "capability:preferences"
const Preferences = Schema.Array(Preference)
const equals = Schema.toEquivalence(Ref)

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Preference>>
  readonly get: (ref: Ref) => Effect.Effect<State | undefined>
  readonly resolve: (ref: Ref, fallback?: boolean) => Effect.Effect<State>
  readonly set: (update: Update) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Capability") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const kv = yield* KV.Service

    const load = Effect.fn("Capability.load")(function* () {
      const stored = yield* kv.get(Key)
      const decoded = Schema.decodeUnknownOption(Preferences)(stored)
      if (stored !== undefined && Option.isNone(decoded)) yield* kv.remove(Key)
      return Option.getOrElse(decoded, () => [])
    })

    const get = Effect.fn("Capability.get")(function* (ref: Ref) {
      return (yield* load()).find((item) => equals(item.ref, ref))?.state
    })

    return Service.of({
      list: load,
      get,
      resolve: Effect.fn("Capability.resolve")(function* (ref, fallback = true) {
        return (yield* get(ref)) ?? (fallback ? "enabled" : "disabled")
      }),
      set: Effect.fn("Capability.set")(function* (update) {
        const preferences = (yield* load()).filter((item) => !equals(item.ref, update.ref))
        yield* kv.set(
          Key,
          update.state === "inherit" ? preferences : [...preferences, { ref: update.ref, state: update.state }],
        )
        yield* bus.publish(Event.Updated, { ref: update.ref })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, KV.node] })
