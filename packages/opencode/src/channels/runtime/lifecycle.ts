import { Effect, Schedule } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"

export const lifecycle = {
  start: (channel: Channel): Effect.Effect<void> =>
    Effect.scoped(channel.start()),
    
  stop: (channel: Channel): Effect.Effect<void> =>
    Effect.scoped(channel.stop()),
    
  health: (channel: Channel): Effect.Effect<ChannelHealth> =>
    channel.health(),
    
  capabilities: (channel: Channel): Effect.Effect<ChannelCapabilities> =>
    channel.capabilities(),
    
  // Auto-reconnection with exponential backoff
  startWithRecovery: (channel: Channel): Effect.Effect<void> =>
    channel.start().pipe(
      Effect.retry(Schedule.exponential(100)),
      Effect.catchCause(cause =>
        Effect.logError(`Channel ${channel.type} failed to start: ${cause}`)
      )
    )
}
