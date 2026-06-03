import { Effect } from "effect"
import type { ChannelCapabilities } from "../contracts/channel"
import { Service as RegistryService } from "./registry"

export const capabilities = {
  getAll: (): Effect.Effect<Record<string, ChannelCapabilities>, never, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const types = yield* registry.list()
      const capabilityChecks = types.map(type =>
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
            } as ChannelCapabilities] as const
          }

          const channelCapabilities = yield* channel.capabilities()
          return [type, channelCapabilities] as const
        })
      )

      const results = yield* Effect.all(capabilityChecks)
      return Object.fromEntries(results)
    }),

  getOne: (channelId: string): Effect.Effect<ChannelCapabilities, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return yield* channel.capabilities()
    })
}
