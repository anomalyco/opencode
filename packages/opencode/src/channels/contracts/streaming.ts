import { Effect } from "effect"

export interface StreamingCapable {
  stream(channelId: string, chunks: AsyncIterable<string>): Effect.Effect<void>
}