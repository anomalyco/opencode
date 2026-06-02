import { Effect } from "effect"
import { Channel } from "../contracts/channel"
import { registry } from "./registry"

export const health = {
  checkAll: (): Effect.Effect<Record<string, ChannelHealth>> =>
    Effect.gen(function* () {
      const types = yield* registry.list()
      const healthPromises = types.map(type =>
        Effect.gen(function* () {
          const channel = yield* registry.get(type)
          if (!channel) {
            return [type, { connected: false, status: "not_found" } as ChannelHealth]
          }
          
          const health = yield* channel.health()
          return [type, health]
        })
      )
      
      const results = yield* Effect.all(healthPromises)
      return Object.fromEntries(results)
    }),
    
  checkOne: (channelId: string): Effect.Effect<ChannelHealth> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return channel.health()
    })
}