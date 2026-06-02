import { Effect } from "effect"
import { ChannelCapabilities } from "../contracts/channel"
import { registry } from "./registry"

export const capabilities = {
  getAll: (): Effect.Effect<Record<string, ChannelCapabilities>> =>
    Effect.gen(function* () {
      const types = yield* registry.list()
      const capabilityPromises = types.map(type =>
        Effect.gen(function* () {
          const channel = yield* registry.get(type)
          if (!channel) {
            return [type, {
              messaging: false,
              editing: false,
              typing: false,
              reactions: false,
              media: false,
              voice: false,
              streaming: false,
              files: false
            } as ChannelCapabilities]
          }
          
          const capabilities = yield* channel.capabilities()
          return [type, capabilities]
        })
      )
      
      const results = yield* Effect.all(capabilityPromises)
      return Object.fromEntries(results)
    }),
    
  getOne: (channelId: string): Effect.Effect<ChannelCapabilities> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return channel.capabilities()
    })
}