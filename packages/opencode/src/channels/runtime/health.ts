import { Effect } from "effect"
import type { Channel, ChannelHealth } from "../contracts/channel"
import { Service as RegistryService } from "./registry"

export const health = {
  checkAll: (): Effect.Effect<Record<string, ChannelHealth>, never, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const types = yield* registry.list()
      const healthChecks = types.map(type =>
        Effect.gen(function* () {
          const channel = yield* registry.get(type)
          if (!channel) {
            return [type, { connected: false, status: "not_found" } as ChannelHealth] as const
          }

          const channelHealth = yield* channel.health()
          return [type, channelHealth] as const
        })
      )

      const results = yield* Effect.all(healthChecks)
      return Object.fromEntries(results)
    }),

  checkOne: (channelId: string): Effect.Effect<ChannelHealth, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return yield* channel.health()
    })
}
