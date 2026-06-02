import { Effect } from "effect"
import { MessageSender } from "../contracts/sender"
import { MessageEditor } from "../contracts/editor"
import { TypingCapable } from "../contracts/typing"
import { ReactionCapable } from "../contracts/reactions"
import { MediaSender, MediaPart } from "../contracts/media"
import { StreamingCapable } from "../contracts/streaming"
import { Channel } from "../contracts/channel"
import { registry } from "./registry"

export const router = {
  sendMessage: (channelId: string, message: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      // In a real implementation, we'd look up the channel by ID from a database
      // For now, we'll assume channelId maps to type for simplicity
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      // Check if channel implements MessageSender
      if ("send" in channel && typeof channel.send === "function") {
        return (channel as MessageSender).send(channelId, message)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support messaging`))
    }),
    
  editMessage: (channelId: string, messageId: string, content: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("edit" in channel && typeof channel.edit === "function") {
        return (channel as MessageEditor).edit(channelId, messageId, content)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support message editing`))
    }),
    
  sendTyping: (channelId: string): Effect.Effect<() => void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("startTyping" in channel && typeof channel.startTyping === "function") {
        return (channel as TypingCapable).startTyping(channelId)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support typing indicators`))
    }),
    
  react: (channelId: string, messageId: string, emoji: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("react" in channel && typeof channel.react === "function") {
        return (channel as ReactionCapable).react(channelId, messageId, emoji)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support reactions`))
    }),
    
  sendMedia: (channelId: string, media: MediaPart[]): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("sendMedia" in channel && typeof channel.sendMedia === "function") {
        return (channel as MediaSender).sendMedia(channelId, media)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support media sending`))
    }),
    
  stream: (channelId: string, chunks: AsyncIterable<string>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("stream" in channel && typeof channel.stream === "function") {
        return (channel as StreamingCapable).stream(channelId, chunks)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support streaming`))
    })
}