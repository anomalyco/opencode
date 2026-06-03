import { Effect } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/email" })

interface EmailConfig {
  readonly smtpHost: string
  readonly smtpPort: number
  readonly smtpUser?: string
  readonly smtpPass?: string
  readonly fromAddress: string
  readonly fromName?: string
}

export class EmailChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "email"
  readonly name: string

  private config: EmailConfig
  private connected = false
  private startTime = 0

  constructor(id: string, name: string, config: EmailConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting email channel", { id: self.id, name: self.name })
      self.connected = true
      self.startTime = Date.now()
      log.info("email channel connected", { id: self.id })
    })
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping email channel", { id: self.id })
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
      editing: false,
      typing: false,
      reactions: false,
      media: false,
      voice: false,
      streaming: false,
      files: true
    })
  }

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        log.error("email channel not connected", { channelId })
        return yield* Effect.void
      }

      log.info("sending email", { channelId, messageLength: message.length })

      // In a real implementation, this would call the SMTP server or API
      // For now, we log the attempt
      yield* Effect.sleep("100 millis")

      log.info("email sent", { channelId })
    })
  }
}
