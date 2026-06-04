import { Effect, Schema } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import type { InboundContext, InboundMessage, SenderInfo, ChatType } from "../contracts/inbound"
import { buildCanonicalId } from "../contracts/identity"
import type { Service as MessageBusService } from "../runtime/bus"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/teams" })

interface TeamsConfig {
  readonly webhookUrl: string
  readonly tenantId?: string
  readonly appId?: string
  readonly appPassword?: string
}

// ---------------------------------------------------------------------------
// Tagged error for Teams API failures (used with Effect.catchTag)
// ---------------------------------------------------------------------------

class TeamsApiError extends Schema.TaggedErrorClass<TeamsApiError>()("TeamsApiError", {
  statusCode: Schema.Number,
  detail: Schema.String
}) {}

// ---------------------------------------------------------------------------
// Teams Channel Implementation (Webhook-only, send-only)
// ---------------------------------------------------------------------------

export class TeamsChannel implements Channel, MessageSender {
  readonly id: string
  readonly type = "teams"
  readonly name: string

  private config: TeamsConfig
  private connected = false
  private startTime = 0
  private lastMessageTime = 0
  private bus: MessageBusService | null = null

  constructor(id: string, name: string, config: TeamsConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  setBus(bus: MessageBusService): void {
    this.bus = bus
  }

  // -------------------------------------------------------------------------
  // Inbound event handling (stub — webhook-only mode)
  // -------------------------------------------------------------------------

  handleTeamsEvent(event: unknown): void {
    log.warn(
      "Teams webhook mode does not support inbound events. Use Bot Framework for bidirectional communication."
    )
  }

  // -------------------------------------------------------------------------
  // Channel interface
  // -------------------------------------------------------------------------

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting teams channel", { id: self.id, name: self.name })

      // Validate webhook URL by sending a test card
      yield* self.webhookPost({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        summary: "OpenCode Teams channel connected",
        themeColor: "0076D7",
        title: "Channel Connected",
        text: `Teams channel **${self.name}** is now connected and ready to receive messages.`
      })

      self.connected = true
      self.startTime = Date.now()
      log.info("teams webhook validated, channel connected", { id: self.id })
    }).pipe(
      Effect.catchTag("TeamsApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start teams channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping teams channel", { id: self.id })
      self.connected = false
      log.info("teams channel stopped", { id: self.id })
    })
  }

  health(): Effect.Effect<ChannelHealth> {
    const self = this
    return Effect.succeed({
      connected: self.connected,
      latency: self.connected ? Date.now() - self.startTime : undefined,
      lastMessage: self.lastMessageTime || undefined,
      reconnectAttempts: 0,
      status: self.connected ? "connected" : "disconnected"
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

  // -------------------------------------------------------------------------
  // MessageSender
  // -------------------------------------------------------------------------

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) {
        return yield* new TeamsApiError({
          statusCode: 0,
          detail: "teams channel not connected"
        })
      }

      log.info("sending teams message", { channelId, messageLength: message.length })

      // Build an Adaptive Card with a clean layout
      const card = {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                {
                  type: "TextBlock",
                  size: "Medium",
                  weight: "Bolder",
                  text: "OpenCode",
                  style: "heading"
                },
                {
                  type: "TextBlock",
                  text: message,
                  wrap: true
                }
              ],
              msteams: {
                entities: []
              }
            }
          }
        ]
      }

      yield* self.webhookPost(card)

      self.lastMessageTime = Date.now()
      log.info("teams message sent", { channelId })
    }).pipe(
      Effect.catchTag("TeamsApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send teams message", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // Private: Webhook POST helper
  // -------------------------------------------------------------------------

  private webhookPost(payload: unknown): Effect.Effect<void, TeamsApiError> {
    const self = this
    return Effect.gen(function* () {
      log.debug("teams webhook POST", { url: self.config.webhookUrl })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(self.config.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }),
        catch: (error) =>
          new TeamsApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new TeamsApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("teams webhook error", {
          status: response.status,
          body: errorBody
        })
        return yield* new TeamsApiError({
          statusCode: response.status,
          detail: errorBody || response.statusText
        })
      }

      log.debug("teams webhook POST succeeded", { status: response.status })
    })
  }
}

export * as TeamsPlugin from "./teams-plugin"
