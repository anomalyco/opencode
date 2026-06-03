import { Context, Effect, Layer, Ref } from "effect"
import type { Channel } from "../contracts/channel"

export interface Interface {
  readonly register: (type: string, channel: Channel) => Effect.Effect<void>
  readonly unregister: (type: string) => Effect.Effect<void>
  readonly get: (type: string) => Effect.Effect<Channel | null>
  readonly list: () => Effect.Effect<ReadonlyArray<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ChannelRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const channels = yield* Ref.make(new Map<string, Channel>())

    return Service.of({
      register: (type, channel) =>
        Ref.update(channels, map => {
          const next = new Map(map)
          next.set(type, channel)
          return next
        }),

      unregister: type =>
        Ref.update(channels, map => {
          const next = new Map(map)
          next.delete(type)
          return next
        }),

      get: type =>
        Effect.gen(function* () {
          const map = yield* Ref.get(channels)
          return map.get(type) ?? null
        }),

      list: () =>
        Effect.gen(function* () {
          const map = yield* Ref.get(channels)
          return Array.from(map.keys())
        }),
    })
  }),
)

export const defaultLayer = layer

export * as Registry from "./registry"
