import { Effect } from "effect"
import { Channel } from "../contracts/channel"
import { Ref } from "effect"

interface Registry {
  readonly channels: Ref.Ref<Map<string, Channel>>
  
  register(type: string, channel: Channel): Effect.Effect<void>
  unregister(type: string): Effect.Effect<void>
  get(type: string): Effect.Effect<Channel | null>
  list(): Effect.Effect<ReadonlyArray<string>>
}

export const registry = Effect.gen(function* () {
  const channels = yield* Ref.make(Map<string, Channel>())
  
  return {
    channels,
    
    register: (type: string, channel: Channel) =>
      Ref.modify(channels, map => {
        map.set(type, channel)
        return map
      }),
      
    unregister: (type: string) =>
      Ref.modify(channels, map => {
        map.delete(type)
        return map
      }),
      
    get: (type: string) =>
      Ref.get(channels).map(map => map.get(type) ?? null),
      
    list: () =>
      Ref.get(channels).map(map => Array.from(map.keys()))
  }
})

export const Registry = {
  registry
}