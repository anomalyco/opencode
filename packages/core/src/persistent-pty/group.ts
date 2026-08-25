export * as Group from "./group.js"

import { Group } from "@opencode-ai/schema/group"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Bus } from "../bus.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { KV } from "../kv.js"

export const ID = Group.ID
export type ID = Group.ID
export const Item = Group.Item
export type Item = Group.Item
export const Info = Group.Info
export type Info = Group.Info
export const Event = Group.Event

export interface Interface {
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly create: (id: ID, items?: ReadonlyArray<Item>) => Effect.Effect<Info>
  readonly addItem: (id: ID, item: Item) => Effect.Effect<Info | undefined>
  readonly removeItem: (id: ID, item: Item) => Effect.Effect<Info | undefined>
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Group") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const bus = yield* Bus.Service
    const locks = KeyedMutex.makeUnsafe<ID>()

    const get = Effect.fn("Group.get")(function* (id: ID) {
      const value = yield* kv.get(`group:v1:${id}`)
      return Schema.is(Info)(value) ? value : undefined
    })

    return Service.of({
      get,
      create: Effect.fn("Group.create")(function* (id, items = []) {
        return yield* locks.withLock(id)(
          Effect.gen(function* () {
            const existing = yield* get(id)
            if (existing) return existing
            const group = Info.make({ id, items: unique(items) })
            yield* kv.set(`group:v1:${id}`, group)
            return group
          }),
        )
      }),
      addItem: Effect.fn("Group.addItem")(function* (id, item) {
        return yield* locks.withLock(id)(
          Effect.gen(function* () {
            const group = yield* get(id)
            if (!group || group.items.some((current) => same(current, item))) return group
            const updated = Info.make({ id, items: group.items.concat(item) })
            yield* kv.set(`group:v1:${id}`, updated)
            yield* bus.publish(Event.ItemAdded, { groupID: id, item })
            return updated
          }),
        )
      }),
      removeItem: Effect.fn("Group.removeItem")(function* (id, item) {
        return yield* locks.withLock(id)(
          Effect.gen(function* () {
            const group = yield* get(id)
            if (!group || !group.items.some((current) => same(current, item))) return group
            const updated = Info.make({ id, items: group.items.filter((current) => !same(current, item)) })
            yield* kv.set(`group:v1:${id}`, updated)
            yield* bus.publish(Event.ItemRemoved, { groupID: id, item })
            return updated
          }),
        )
      }),
      remove: Effect.fn("Group.remove")(function* (id) {
        yield* locks.withLock(id)(
          Effect.gen(function* () {
            const group = yield* get(id)
            yield* kv.remove(`group:v1:${id}`)
            if (!group) return
            yield* Effect.forEach(group.items, (item) => bus.publish(Event.ItemRemoved, { groupID: id, item }), {
              discard: true,
            })
          }),
        )
      }),
    })
  }),
)

function same(left: Item, right: Item) {
  return left.type === right.type && left.id === right.id
}

function unique(items: ReadonlyArray<Item>) {
  return items.filter((item, index) => items.findIndex((current) => same(current, item)) === index)
}

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Bus.node] })
