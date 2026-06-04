import { Effect, Schema } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import type { MessageEditor } from "../contracts/editor"
import type { TypingCapable } from "../contracts/typing"
import type { ReactionCapable } from "../contracts/reactions"
import type { MediaSender, MediaPart } from "../contracts/media"
import type { InboundContext, InboundMessage, SenderInfo, ChatType } from "../contracts/inbound"
import { buildCanonicalId } from "../contracts/identity"
import type { Interface as MessageBus } from "../runtime/bus"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/slack" })

const SLACK_API_BASE = "https://slack.com/api"

interface SlackConfig {
  readonly botToken: string
  readonly appToken?: string
  readonly signingSecret?: string
}

interface SlackApiResponse {
  readonly ok: boolean
  readonly error?: string
  readonly [key: string]: unknown
}

interface AuthTestResponse extends SlackApiResponse {
  readonly user_id: string
  readonly user: string
  readonly team_id: string
  readonly team: string
}

interface SlackMessageEvent {
  type: string
  user: string
  text: string
  channel: string
  channel_type: string
  ts: string
  thread_ts?: string
  bot_id?: string
  files?: Array<{ id: string; name: string; mimetype: string; url_private: string }>
}

// ---------------------------------------------------------------------------
// Tagged error for Slack API failures (used with Effect.catchTag)
// ---------------------------------------------------------------------------

class SlackApiError extends Schema.TaggedErrorClass<SlackApiError>()("SlackApiError", {
  statusCode: Schema.Number,
  detail: Schema.String
}) {}

// ---------------------------------------------------------------------------
// Slack Channel Implementation
// ---------------------------------------------------------------------------

export class SlackChannel
  implements Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
{
  readonly id: string
  readonly type = "slack"
  readonly name: string

  private config: SlackConfig
  private connected = false
  private startTime = 0
  private lastMessageTime = 0
  private reconnectAttempts = 0
  private botUserId: string | undefined
  private bus: MessageBus | undefined
  private readonly abortController = new AbortController()

  constructor(id: string, name: string, config: SlackConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  setBus(bus: MessageBus): void {
    this.bus = bus
  }

  // -------------------------------------------------------------------------
  // Channel interface
  // -------------------------------------------------------------------------

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting slack channel", { id: self.id, name: self.name })

      // Validate bot token with auth.test
      const authResult = yield* self.apiFetchJson<AuthTestResponse>("/auth.test")
      self.connected = true
      self.startTime = Date.now()
      self.botUserId = authResult.user_id
      log.info("slack bot token validated", { id: self.id, user: authResult.user, team: authResult.team })

      log.info("slack channel started", { id: self.id })
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start slack channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping slack channel", { id: self.id })
      self.abortController.abort()
      self.connected = false
      self.botUserId = undefined
      log.info("slack channel stopped", { id: self.id })
    })
  }

  health(): Effect.Effect<ChannelHealth> {
    const self = this
    return Effect.succeed({
      connected: self.connected,
      latency: self.connected ? Date.now() - self.startTime : undefined,
      lastMessage: self.lastMessageTime || undefined,
      reconnectAttempts: self.reconnectAttempts,
      status: self.connected ? "connected" : "disconnected"
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

  // -------------------------------------------------------------------------
  // MessageSender
  // -------------------------------------------------------------------------

  send(channelId: string, message: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("sending slack message", { channelId, messageLength: message.length })

      yield* self.apiFetch("/chat.postMessage", "POST", {
        channel: channelId,
        text: message
      })

      self.lastMessageTime = Date.now()
      log.info("slack message sent", { channelId })
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send slack message", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // MessageEditor
  // -------------------------------------------------------------------------

  edit(channelId: string, messageId: string, content: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("editing slack message", { channelId, messageId })

      yield* self.apiFetch("/chat.update", "POST", {
        channel: channelId,
        ts: messageId,
        text: content
      })

      log.info("slack message edited", { channelId, messageId })
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to edit slack message", { channelId, messageId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // TypingCapable
  // -------------------------------------------------------------------------

  startTyping(channelId: string): Effect.Effect<() => void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting typing indicator", { channelId })

      yield* self.apiFetch("/typing.start", "POST", {
        channel: channelId
      })

      // Slack typing indicators last ~3 seconds; the stop fn is a no-op
      log.info("typing indicator started", { channelId })
      return () => {
        log.debug("typing indicator stop called (expires naturally)", { channelId })
      }
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start typing indicator", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // ReactionCapable
  // -------------------------------------------------------------------------

  react(channelId: string, messageId: string, emoji: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      // Slack emoji names should not include colons
      const name = emoji.replace(/^:|:$/g, "")
      log.info("adding reaction", { channelId, messageId, emoji: name })

      yield* self.apiFetch("/reactions.add", "POST", {
        channel: channelId,
        name,
        timestamp: messageId
      })

      log.info("reaction added", { channelId, messageId, emoji: name })
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to add reaction", { channelId, messageId, emoji, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // MediaSender
  // -------------------------------------------------------------------------

  sendMedia(channelId: string, media: MediaPart[]): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("sending slack media", { channelId, count: media.length })

      for (let i = 0; i < media.length; i++) {
        const part = media[i]
        const filename = part.filename ?? `file_${i}`
        const mimeType = part.mimeType ?? self.inferMimeType(part.type)
        const blob = new Blob([new Uint8Array(part.data)], { type: mimeType })

        const formData = new FormData()
        formData.append("channels", channelId)
        formData.append("file", blob, filename)
        formData.append("filename", filename)
        formData.append("initial_comment", "")

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${SLACK_API_BASE}/files.upload`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${self.config.botToken}`
              },
              body: formData,
              signal: self.abortController.signal
            }),
          catch: (error) =>
            new SlackApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
        })

        if (!response.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: response.status,
              detail: `failed to upload file: ${response.statusText}`
            })
          )
        }

        // Parse Slack response to check for API-level errors
        const result = yield* Effect.tryPromise({
          try: () => response.json() as Promise<SlackApiResponse>,
          catch: () => new SlackApiError({ statusCode: 0, detail: "failed to parse upload response" })
        })

        if (!result.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: 200,
              detail: `slack API error: ${result.error ?? "unknown"}`
            })
          )
        }

        log.info("slack file uploaded", { channelId, filename })
      }

      self.lastMessageTime = Date.now()
      log.info("slack media sent", { channelId, count: media.length })
    }).pipe(
      Effect.catchTag("SlackApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send slack media", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // Inbound message handling
  // -------------------------------------------------------------------------

  handleEvent(event: unknown): void {
    const self = this
    const msg = event as SlackMessageEvent
    if (msg?.type !== "message" || !msg.user || !msg.text || msg.bot_id) return

    Effect.runFork(
      Effect.gen(function* () {
        yield* self.handleSlackEvent(msg)
      }).pipe(Effect.catch(() => Effect.void))
    )
  }

  private handleSlackEvent(event: SlackMessageEvent): Effect.Effect<void, never, never> {
    const self = this
    return Effect.gen(function* () {
      if (!self.bus) {
        log.debug("no bus attached, ignoring slack event", { channel: event.channel })
        return yield* Effect.void
      }

      const canonicalId = buildCanonicalId("slack", event.user)
      const chatType: ChatType = event.channel_type === "im" ? "private" : "channel"
      const mentioned = self.botUserId ? event.text.includes(`<@${self.botUserId}>`) : false

      const sender: SenderInfo = {
        platform: "slack",
        platformId: event.user,
        canonicalId
      }

      const context: InboundContext = {
        channel: "slack",
        chatId: event.channel,
        chatType,
        senderId: event.user,
        messageId: event.ts,
        mentioned,
        replyToMessageId: event.thread_ts,
        raw: event as unknown as Record<string, unknown>
      }

      const inbound: InboundMessage = {
        context,
        sender,
        content: event.text,
        media: [],
        sessionKey: `slack:${event.channel}`,
        channel: event.channel,
        senderId: event.user,
        chatId: event.channel,
        messageId: event.ts
      }

      yield* self.bus.publish(inbound)
      log.info("inbound slack message published", {
        channel: event.channel,
        user: event.user,
        mentioned,
        chatType
      })
    })
  }

  private apiFetch(
    endpoint: string,
    method: string,
    body?: unknown
  ): Effect.Effect<void, SlackApiError> {
    const self = this
    return Effect.gen(function* () {
      const url = `${SLACK_API_BASE}${endpoint}`
      const headers: Record<string, string> = {
        Authorization: `Bearer ${self.config.botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      }

      const init: RequestInit = {
        method,
        headers,
        signal: self.abortController.signal
      }

      if (body !== undefined) {
        init.body = JSON.stringify(body)
      }

      log.debug("slack REST request", { method, endpoint })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new SlackApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After")
        const delayMs = Math.ceil((Number(retryAfter) || 1) * 1000)
        log.warn("slack rate limited, retrying after delay", { endpoint, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new SlackApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: retryResponse.status,
              detail: `retry failed: ${retryResponse.statusText}`
            })
          )
        }

        // Check Slack API-level error on retry
        const retryResult = yield* Effect.tryPromise({
          try: () => retryResponse.json() as Promise<SlackApiResponse>,
          catch: () => new SlackApiError({ statusCode: 0, detail: "failed to parse retry response" })
        })

        if (!retryResult.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: 429,
              detail: `slack API error after retry: ${retryResult.error ?? "unknown"}`
            })
          )
        }
        return
      }

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new SlackApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("slack API error", { method, endpoint, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new SlackApiError({ statusCode: response.status, detail: errorBody })
        )
      }

      // Parse Slack JSON response and check for API-level errors
      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<SlackApiResponse>,
        catch: () => new SlackApiError({ statusCode: 0, detail: "failed to parse response" })
      })

      if (!result.ok) {
        return yield* Effect.fail(
          new SlackApiError({
            statusCode: 200,
            detail: `slack API error: ${result.error ?? "unknown"}`
          })
        )
      }
    })
  }

  private apiFetchJson<T extends SlackApiResponse>(
    endpoint: string,
    method?: string,
    body?: unknown
  ): Effect.Effect<T, SlackApiError> {
    const self = this
    return Effect.gen(function* () {
      const url = `${SLACK_API_BASE}${endpoint}`
      const headers: Record<string, string> = {
        Authorization: `Bearer ${self.config.botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      }

      const init: RequestInit = {
        method: method ?? "POST",
        headers,
        signal: self.abortController.signal
      }

      if (body !== undefined) {
        init.body = JSON.stringify(body)
      }

      log.debug("slack REST request", { method: init.method, endpoint })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new SlackApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After")
        const delayMs = Math.ceil((Number(retryAfter) || 1) * 1000)
        log.warn("slack rate limited, retrying after delay", { endpoint, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new SlackApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: retryResponse.status,
              detail: `retry failed: ${retryResponse.statusText}`
            })
          )
        }

        const retryResult = yield* Effect.tryPromise({
          try: () => retryResponse.json() as Promise<T>,
          catch: () => new SlackApiError({ statusCode: 0, detail: "failed to parse retry response" })
        })

        if (!retryResult.ok) {
          return yield* Effect.fail(
            new SlackApiError({
              statusCode: 429,
              detail: `slack API error after retry: ${retryResult.error ?? "unknown"}`
            })
          )
        }

        return retryResult
      }

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new SlackApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("slack API error", { method: init.method, endpoint, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new SlackApiError({ statusCode: response.status, detail: errorBody })
        )
      }

      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<T>,
        catch: () => new SlackApiError({ statusCode: 0, detail: "failed to parse response" })
      })

      if (!result.ok) {
        return yield* Effect.fail(
          new SlackApiError({
            statusCode: 200,
            detail: `slack API error: ${result.error ?? "unknown"}`
          })
        )
      }

      return result
    })
  }

  // -------------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------------

  private inferMimeType(type: MediaPart["type"]): string {
    switch (type) {
      case "image":
        return "image/png"
      case "video":
        return "video/mp4"
      case "audio":
        return "audio/mpeg"
      case "document":
        return "application/octet-stream"
    }
  }
}

export * as SlackPlugin from "./slack-plugin"
