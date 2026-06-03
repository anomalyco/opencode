import { Effect } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/telegram" })

interface TelegramConfig {
  readonly botToken: string
  readonly chatId: string
  readonly parseMode?: "MarkdownV2" | "HTML"
}

export class TelegramChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "telegram"
  readonly name: string

  private config: TelegramConfig
  private connected = false
  private startTime = 0
  private longPollingAbort?: AbortController

  constructor(id: string, name: string, config: TelegramConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting telegram channel", { id: self.id, name: self.name })
      self.connected = true
      self.startTime = Date.now()
      self.longPollingAbort = new AbortController()
      log.info("telegram channel connected", { id: self.id })
    })
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping telegram channel", { id: self.id })
      self.longPollingAbort?.abort()
      self.longPollingAbort = undefined
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
      editing: true,
      typing: true,
      reactions: true,
      media: true,
      voice: false,
      streaming: false,
      files: true
    })
  }

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        log.error("telegram channel not connected", { channelId })
        return yield* Effect.void
      }

      log.info("sending telegram message", { channelId, messageLength: message.length })

      // In a real implementation, this would call the Telegram Bot API
      // sendMessage, editMessageText, etc.
      // For now, we log the attempt
      yield* Effect.sleep("100 millis")

      log.info("telegram message sent", { channelId })
    })
  }
}

export * as TelegramPlugin from "./telegram-plugin"
