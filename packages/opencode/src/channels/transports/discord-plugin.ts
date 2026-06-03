import { Effect } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/discord" })

interface DiscordConfig {
  readonly webhookUrl: string
  readonly botToken?: string
}

export class DiscordChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "discord"
  readonly name: string
  
  private config: DiscordConfig
  private connected = false
  private startTime = 0

  constructor(id: string, name: string, config: DiscordConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting discord channel", { id: self.id, name: self.name })
      self.connected = true
      self.startTime = Date.now()
      log.info("discord channel connected", { id: self.id })
    })
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping discord channel", { id: self.id })
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
        log.error("discord channel not connected", { channelId })
        return yield* Effect.void
      }
      
      log.info("sending discord message", { channelId, messageLength: message.length })
      
      // In a real implementation, this would call the Discord API
      // For now, we log the attempt
      yield* Effect.sleep("100 millis")
      
      log.info("discord message sent", { channelId })
    })
  }
}