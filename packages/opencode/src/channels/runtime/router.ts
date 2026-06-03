import { Effect } from "effect"
import type { MessageSender } from "../contracts/sender"
import type { MessageEditor } from "../contracts/editor"
import type { TypingCapable } from "../contracts/typing"
import type { ReactionCapable } from "../contracts/reactions"
import type { MediaSender, MediaPart } from "../contracts/media"
import type { StreamingCapable } from "../contracts/streaming"
import { Service as RegistryService } from "./registry"

export const router = {
  sendMessage: (channelId: string, message: string): Effect.Effect<void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("send" in channel && typeof channel.send === "function") {
        return yield* (channel as unknown as MessageSender).send(channelId, message)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support messaging`))
    }),

  editMessage: (channelId: string, messageId: string, content: string): Effect.Effect<void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("edit" in channel && typeof channel.edit === "function") {
        return yield* (channel as unknown as MessageEditor).edit(channelId, messageId, content)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support message editing`))
    }),

  sendTyping: (channelId: string): Effect.Effect<() => void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("startTyping" in channel && typeof channel.startTyping === "function") {
        return yield* (channel as unknown as TypingCapable).startTyping(channelId)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support typing indicators`))
    }),

  react: (channelId: string, messageId: string, emoji: string): Effect.Effect<void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("react" in channel && typeof channel.react === "function") {
        return yield* (channel as unknown as ReactionCapable).react(channelId, messageId, emoji)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support reactions`))
    }),

  sendMedia: (channelId: string, media: MediaPart[]): Effect.Effect<void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("sendMedia" in channel && typeof channel.sendMedia === "function") {
        return yield* (channel as unknown as MediaSender).sendMedia(channelId, media)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support media sending`))
    }),

  stream: (channelId: string, chunks: AsyncIterable<string>): Effect.Effect<void, Error, RegistryService> =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const channel = yield* registry.get(channelId)

      if (!channel) {
        return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
      }

      if ("stream" in channel && typeof channel.stream === "function") {
        return yield* (channel as unknown as StreamingCapable).stream(channelId, chunks)
      }

      return yield* Effect.fail(new Error(`Channel ${channelId} does not support streaming`))
    })
}
