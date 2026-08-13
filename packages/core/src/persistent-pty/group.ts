export * as Group from "./group.js"

import { Group } from "@opencode-ai/schema/group"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { KV } from "../kv.js"

export const ID = Group.ID
export type ID = Group.ID
export const Item = Group.Item
export type Item = Group.Item
export const Info = Group.Info
export type Info = Group.Info

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly create: (items?: ReadonlyArray<Item>) => Effect.Effect<Info>
  readonly set: (group: Info) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Group") {}

const key = "group:v1"
const Document = Schema.Array(Info)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const lock = Semaphore.makeUnsafe(1)

    const list = Effect.fn("Group.list")(function* () {
      const value = yield* kv.get(key)
      return Schema.is(Document)(value) ? value : []
    })

    return Service.of({
      list,
      get: Effect.fn("Group.get")(function* (id) {
        return (yield* list()).find((group) => group.id === id)
      }),
      create: Effect.fn("Group.create")(function* (items = []) {
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const group = Info.make({ id: ID.create(), items: Array.from(items) })
            yield* kv.set(key, (yield* list()).concat(group))
            return group
          }),
        )
      }),
      set: Effect.fn("Group.set")(function* (group) {
        yield* lock.withPermit(
          Effect.gen(function* () {
            const groups = yield* list()
            const index = groups.findIndex((item) => item.id === group.id)
            yield* kv.set(
              key,
              index === -1 ? groups.concat(group) : groups.map((item) => (item.id === group.id ? group : item)),
            )
          }),
        )
      }),
      remove: Effect.fn("Group.remove")(function* (id) {
        yield* lock.withPermit(
          Effect.gen(function* () {
            yield* kv.set(
              key,
              (yield* list()).filter((group) => group.id !== id),
            )
          }),
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
