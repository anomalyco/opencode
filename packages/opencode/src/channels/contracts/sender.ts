import { Effect } from "effect"

export interface MessageSender {
  send(channelId: string, message: string): Effect.Effect<void>
}