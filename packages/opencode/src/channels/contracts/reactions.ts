import { Effect } from "effect"

export interface ReactionCapable {
  react(channelId: string, messageId: string, emoji: string): Effect.Effect<void>
}