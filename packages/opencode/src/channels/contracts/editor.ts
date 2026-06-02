import { Effect } from "effect"

export interface MessageEditor {
  edit(channelId: string, messageId: string, content: string): Effect.Effect<void>
}