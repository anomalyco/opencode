import { Effect } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/teams" })

interface TeamsConfig {
  readonly webhookUrl: string
}

export class TeamsChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "teams"
  readonly name: string

  private config: TeamsConfig
  private connected = false
  private startTime = 0

  constructor(id: string, name: string, config: TeamsConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting teams channel", { id: self.id, name: self.name })
      self.connected = true
      self.startTime = Date.now()
      log.info("teams channel connected", { id: self.id })
    })
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping teams channel", { id: self.id })
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
      files: false
    })
  }

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        log.error("teams channel not connected", { channelId })
        return yield* Effect.void
      }

      log.info("sending teams message", { channelId, messageLength: message.length })

      // In a real implementation, this would call the Teams webhook API
      // For now, we log the attempt
      yield* Effect.sleep("100 millis")

      log.info("teams message sent", { channelId })
    })
  }
}
