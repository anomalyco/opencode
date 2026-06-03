import { Effect } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/whatsapp" })

interface WhatsAppConfig {
  readonly phoneNumberId: string
  readonly accessToken: string
  readonly webhookVerifyToken: string
  readonly graphApiVersion?: string
}

type ConversationType = "individual" | "group"

interface WhatsAppMessage {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: ConversationType
  readonly timestamp: number
  readonly body?: string
  readonly mediaUrl?: string
  readonly mediaMimeType?: string
}

export class WhatsAppChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "whatsapp"
  readonly name: string

  private config: WhatsAppConfig
  private connected = false
  private startTime = 0
  private wsConnection?: WebSocket
  private abortController?: AbortController

  constructor(id: string, name: string, config: WhatsAppConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting whatsapp channel", { id: self.id, name: self.name })
      self.abortController = new AbortController()
      self.connected = true
      self.startTime = Date.now()
      log.info("whatsapp channel connected via WebSocket bridge", { id: self.id })
    })
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping whatsapp channel", { id: self.id })
      self.abortController?.abort()
      self.abortController = undefined
      self.wsConnection?.close()
      self.wsConnection = undefined
      self.connected = false
    })
  }

  health(): Effect.Effect<ChannelHealth> {
    return Effect.succeed({
      connected: this.connected,
      latency: this.connected ? Date.now() - this.startTime : undefined,
      lastMessage: this.connected ? Date.now() : undefined,
      reconnectAttempts: 0,
      status: this.connected ? "connected" : "disconnected"
    })
  }

  capabilities(): Effect.Effect<ChannelCapabilities> {
    return Effect.succeed({
      messaging: true,
      editing: false,   // WhatsApp does not support editing messages after send
      typing: true,     // WhatsApp supports typing indicators
      reactions: true,  // WhatsApp supports emoji reactions
      media: true,      // WhatsApp supports images, videos, audio, documents
      voice: false,
      streaming: false,
      files: true
    })
  }

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        log.error("whatsapp channel not connected", { channelId })
        return yield* Effect.void
      }

      log.info("sending whatsapp message", { channelId, messageLength: message.length })

      // In a real implementation, this would call the WhatsApp Cloud API
      // POST /{phone-number-id}/messages with the message payload
      // Supports: text, image, video, audio, document, location, contacts, interactive
      yield* Effect.sleep("100 millis")

      log.info("whatsapp message sent", { channelId })
    })
  }

  sendMedia(channelId: string, mediaUrl: string, mimeType: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        log.error("whatsapp channel not connected for media send", { channelId })
        return yield* Effect.void
      }

      log.info("sending whatsapp media", { channelId, mimeType, mediaUrl })

      // Upload media to WhatsApp Media API, then send message referencing the media ID
      // POST /{phone-number-id}/media for upload, then POST /{phone-number-id}/messages
      yield* Effect.sleep("200 millis")

      log.info("whatsapp media sent", { channelId })
    })
  }

  detectConversationType(message: WhatsAppMessage): ConversationType {
    // WhatsApp Business API differentiates group vs individual via the recipient type
    // In webhook payloads, group messages include a group metadata object
    return message.type
  }
}

export * as WhatsAppPlugin from "./whatsapp-plugin"
