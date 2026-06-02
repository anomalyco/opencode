import { Effect } from "effect"

export interface TypingCapable {
  startTyping(channelId: string): Effect.Effect<() => void>
}