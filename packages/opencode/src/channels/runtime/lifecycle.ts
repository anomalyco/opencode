import { Effect } from "effect"
import { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import { Schedule } from "effect"

export const lifecycle = {
  start: (channel: Channel): Effect.Effect<void> =>
    Effect.scopedEffect(channel.start()),
    
  stop: (channel: Channel): Effect.Effect<void> =>
    Effect.scopedEffect(channel.stop()),
    
  health: (channel: Channel): Effect.Effect<ChannelHealth> =>
    channel.health(),
    
  capabilities: (channel: Channel): Effect.Effect<ChannelCapabilities> =>
    channel.capabilities(),
    
  // Auto-reconnection with exponential backoff
  startWithRecovery: (channel: Channel): Effect.Effect<void> =>
    Effect.retry(
      channel.start(),
      Schedule.exponential("100 millis").whileInput(() => true)
    ).tapErrorCause(cause =>
      Effect.logError(`Channel ${channel.type} failed to start: ${cause}`)
    )
}