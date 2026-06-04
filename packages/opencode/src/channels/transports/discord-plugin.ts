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

const log = Log.create({ service: "channels/discord" })

const DISCORD_API_BASE = "https://discord.com/api/v10"
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"

interface DiscordConfig {
  readonly botToken: string
  readonly gatewayEnabled?: boolean
}

interface GatewayPayload {
  readonly op: number
  readonly d: unknown
  readonly s: number | null
  readonly t: string | null
}

interface ReadyData {
  readonly user: { readonly id: string; readonly username: string }
  readonly session_id: string
}

interface MessageCreateData {
  readonly id: string
  readonly channel_id: string
  readonly content: string
  readonly author: { readonly id: string; readonly username: string }
  readonly guild_id?: string
  readonly timestamp: string
  readonly mentions?: ReadonlyArray<{ readonly id: string; readonly username: string }>
  readonly message_reference?: { readonly message_id: string }
  readonly attachments?: ReadonlyArray<{
    readonly id: string
    readonly filename: string
    readonly content_type: string
    readonly url: string
    readonly size: number
  }>
  readonly type?: number
}

// ---------------------------------------------------------------------------
// Tagged error for Discord API failures (used with Effect.catchTag)
// ---------------------------------------------------------------------------

class DiscordApiError extends Schema.TaggedErrorClass<DiscordApiError>()("DiscordApiError", {
  statusCode: Schema.Number,
  detail: Schema.String
}) {}

// ---------------------------------------------------------------------------
// Discord Channel Implementation
// ---------------------------------------------------------------------------

export class DiscordChannel
  implements Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
{
  readonly id: string
  readonly type = "discord"
  readonly name: string

  private config: DiscordConfig
  private connected = false
  private gatewayReady = false
  private startTime = 0
  private lastMessageTime = 0
  private reconnectAttempts = 0
  private ws: import("ws").WebSocket | undefined
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined
  private session_id: string | undefined
  private sequence: number | null = null
  private readonly abortController = new AbortController()
  private bus: MessageBus | undefined

  constructor(id: string, name: string, config: DiscordConfig) {
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
      log.info("starting discord channel", { id: self.id, name: self.name })

      // Validate bot token with a REST call
      const me = yield* self.restFetchJson<{ username: string }>("/users/@me", "GET")
      self.connected = true
      self.startTime = Date.now()
      log.info("discord bot token validated", { id: self.id, user: me.username })

      // Connect to gateway if enabled
      if (self.config.gatewayEnabled) {
        yield* self.connectGateway()
      }

      log.info("discord channel started", { id: self.id })
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start discord channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping discord channel", { id: self.id })
      self.abortController.abort()

      if (self.heartbeatInterval) {
        clearInterval(self.heartbeatInterval)
        self.heartbeatInterval = undefined
      }

      if (self.ws) {
        self.ws.close(1000, "shutdown")
        self.ws = undefined
      }

      self.connected = false
      self.gatewayReady = false
      self.session_id = undefined
      self.sequence = null
      log.info("discord channel stopped", { id: self.id })
    })
  }

  health(): Effect.Effect<ChannelHealth> {
    const self = this
    return Effect.succeed({
      connected: self.connected,
      latency: self.connected ? Date.now() - self.startTime : undefined,
      lastMessage: self.lastMessageTime || undefined,
      reconnectAttempts: self.reconnectAttempts,
      status: !self.connected
        ? "disconnected"
        : self.gatewayReady
          ? "connected"
          : "connecting"
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
      log.info("sending discord message", { channelId, messageLength: message.length })

      yield* self.restFetch(`/channels/${channelId}/messages`, "POST", {
        content: message
      })

      self.lastMessageTime = Date.now()
      log.info("discord message sent", { channelId })
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send discord message", { channelId, error: error.detail })
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
      log.info("editing discord message", { channelId, messageId })

      yield* self.restFetch(`/channels/${channelId}/messages/${messageId}`, "PATCH", {
        content
      })

      log.info("discord message edited", { channelId, messageId })
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to edit discord message", { channelId, messageId, error: error.detail })
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

      yield* self.restFetch(`/channels/${channelId}/typing`, "POST")

      // Discord typing indicators last ~10 seconds; the stop fn is a no-op
      log.info("typing indicator started", { channelId })
      return () => {
        log.debug("typing indicator stop called (expires naturally)", { channelId })
      }
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
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
      const encoded = encodeURIComponent(emoji)
      log.info("adding reaction", { channelId, messageId, emoji })

      yield* self.restFetch(
        `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
        "PUT"
      )

      log.info("reaction added", { channelId, messageId, emoji })
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
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
      log.info("sending discord media", { channelId, count: media.length })

      const formData = new FormData()
      formData.append("payload_json", JSON.stringify({ content: "" }))

      for (let i = 0; i < media.length; i++) {
        const part = media[i]
        const filename = part.filename ?? `file_${i}`
        const mimeType = part.mimeType ?? self.inferMimeType(part.type)
        const blob = new Blob([new Uint8Array(part.data)], { type: mimeType })
        formData.append(`files[${i}]`, blob, filename)
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${self.config.botToken}`
            },
            body: formData,
            signal: self.abortController.signal
          }),
        catch: (error) =>
          new DiscordApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      if (!response.ok) {
        return yield* Effect.fail(
          new DiscordApiError({
            statusCode: response.status,
            detail: `failed to send media: ${response.statusText}`
          })
        )
      }

      self.lastMessageTime = Date.now()
      log.info("discord media sent", { channelId, count: media.length })
    }).pipe(
      Effect.catchTag("DiscordApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send discord media", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // Private: REST API helpers
  // -------------------------------------------------------------------------

  private restFetch(
    path: string,
    method: string,
    body?: unknown
  ): Effect.Effect<void, DiscordApiError> {
    const self = this
    return Effect.gen(function* () {
      const url = `${DISCORD_API_BASE}${path}`
      const headers: Record<string, string> = {
        Authorization: `Bot ${self.config.botToken}`,
        "User-Agent": "OpenCode-Discord-Channel/1.0"
      }

      const init: RequestInit = {
        method,
        headers,
        signal: self.abortController.signal
      }

      if (body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(body)
      }

      log.debug("discord REST request", { method, path })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new DiscordApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryData = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ retry_after: number }>,
          catch: () => new DiscordApiError({ statusCode: 429, detail: "rate limited" })
        })
        const delayMs = Math.ceil((retryData.retry_after ?? 1) * 1000)
        log.warn("discord rate limited, retrying after delay", { path, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new DiscordApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new DiscordApiError({
              statusCode: retryResponse.status,
              detail: `retry failed: ${retryResponse.statusText}`
            })
          )
        }
        return
      }

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new DiscordApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("discord API error", { method, path, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new DiscordApiError({ statusCode: response.status, detail: errorBody })
        )
      }
    })
  }

  private restFetchJson<T = unknown>(
    path: string,
    method: string,
    body?: unknown
  ): Effect.Effect<T, DiscordApiError> {
    const self = this
    return Effect.gen(function* () {
      const url = `${DISCORD_API_BASE}${path}`
      const headers: Record<string, string> = {
        Authorization: `Bot ${self.config.botToken}`,
        "User-Agent": "OpenCode-Discord-Channel/1.0"
      }

      const init: RequestInit = {
        method,
        headers,
        signal: self.abortController.signal
      }

      if (body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(body)
      }

      log.debug("discord REST request", { method, path })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new DiscordApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryData = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ retry_after: number }>,
          catch: () => new DiscordApiError({ statusCode: 429, detail: "rate limited" })
        })
        const delayMs = Math.ceil((retryData.retry_after ?? 1) * 1000)
        log.warn("discord rate limited, retrying after delay", { path, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new DiscordApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new DiscordApiError({
              statusCode: retryResponse.status,
              detail: `retry failed: ${retryResponse.statusText}`
            })
          )
        }

        if (retryResponse.status === 204) {
          return yield* Effect.fail(
            new DiscordApiError({ statusCode: 204, detail: "unexpected 204" })
          )
        }

        return (yield* Effect.tryPromise({
          try: () => retryResponse.json(),
          catch: () => new DiscordApiError({ statusCode: 204, detail: "failed to parse retry response" })
        })) as T
      }

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new DiscordApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("discord API error", { method, path, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new DiscordApiError({ statusCode: response.status, detail: errorBody })
        )
      }

      if (response.status === 204) {
        return yield* Effect.fail(
          new DiscordApiError({ statusCode: 204, detail: "unexpected 204" })
        )
      }

      return (yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new DiscordApiError({ statusCode: 0, detail: "failed to parse response" })
      })) as T
    })
  }

  // -------------------------------------------------------------------------
  // Private: Gateway WebSocket
  // -------------------------------------------------------------------------

  private connectGateway(): Effect.Effect<void, DiscordApiError> {
    const self = this
    return Effect.gen(function* () {
      log.info("connecting to discord gateway", { id: self.id })

      yield* Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            try {
              const { WebSocket } = require("ws") as typeof import("ws")
              const ws = new WebSocket(GATEWAY_URL)

              ws.on("open", () => {
                log.debug("gateway websocket opened")
                ws.send(
                  JSON.stringify({
                    op: 2,
                    d: {
                      token: self.config.botToken,
                      intents: 512
                    }
                  })
                )
              })

              ws.on("message", (raw: Buffer | string) => {
                try {
                  const payload = JSON.parse(String(raw)) as GatewayPayload
                  self.handleGatewayPayload(payload)
                } catch {
                  log.debug("failed to parse gateway payload")
                }
              })

              ws.on("close", (code: number) => {
                log.warn("gateway websocket closed", { code })
                self.gatewayReady = false
                if (code !== 1000 && self.connected) {
                  self.scheduleReconnect()
                }
              })

              ws.on("error", (err: Error) => {
                log.error("gateway websocket error", { error: err.message })
                reject(err)
              })

              self.ws = ws
              resolve()
            } catch (error) {
              reject(error)
            }
          }),
        catch: (error) =>
          new DiscordApiError({
            statusCode: 0,
            detail: `gateway connect failed: ${String(error)}`
          })
      })
    })
  }

  private handleGatewayPayload(payload: GatewayPayload): void {
    if (payload.s !== null) {
      this.sequence = payload.s
    }

    switch (payload.op) {
      case 0: // Dispatch
        this.handleDispatch(payload.t ?? "", payload.d)
        break
      case 1: // Heartbeat request
        this.sendHeartbeat()
        break
      case 7: // Reconnect
        log.warn("gateway requested reconnect")
        this.ws?.close(4000, "reconnect")
        this.scheduleReconnect()
        break
      case 9: // Invalid session
        log.warn("gateway invalid session", { d: payload.d })
        this.scheduleReconnect()
        break
      case 10: {
        // Hello
        const hello = payload.d as { heartbeat_interval: number }
        this.startHeartbeat(hello.heartbeat_interval)
        break
      }
      case 11: // Heartbeat ACK
        log.debug("gateway heartbeat acknowledged")
        break
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    switch (event) {
      case "READY": {
        const ready = data as ReadyData
        this.session_id = ready.session_id
        this.gatewayReady = true
        this.reconnectAttempts = 0
        log.info("gateway ready", {
          username: ready.user.username,
          session_id: ready.session_id
        })
        break
      }
      case "MESSAGE_CREATE": {
        const msg = data as MessageCreateData
        this.lastMessageTime = Date.now()
        log.debug("gateway message received", {
          channelId: msg.channel_id,
          author: msg.author.username,
          length: msg.content.length
        })

        // Build and publish inbound message if bus is available
        if (this.bus) {
          const self = this
          const inbound: InboundMessage = (() => {
            // Determine chat type
            const chatType: ChatType = msg.type === 1 ? "private" : "group"

            // Detect mentions
            const isMentioned = msg.mentions?.some((mention) => mention.id === self.session_id) ?? false

            // Build sender info
            const sender: SenderInfo = {
              platform: "discord",
              platformId: msg.author.id,
              canonicalId: buildCanonicalId("discord", msg.author.id),
              username: msg.author.username
            }

            // Build media from attachments
            const media: MediaPart[] = (msg.attachments ?? []).map((attachment) => ({
              type: attachment.content_type.startsWith("image/") ? "image" as const : "document" as const,
              data: new Uint8Array(0), // Will be downloaded later if needed
              filename: attachment.filename,
              mimeType: attachment.content_type
            }))

            // Build inbound context
            const context: InboundContext = {
              channel: "discord",
              chatId: msg.channel_id,
              chatType,
              senderId: msg.author.id,
              messageId: msg.id,
              mentioned: isMentioned,
              replyToMessageId: msg.message_reference?.message_id,
              spaceId: msg.guild_id,
              spaceType: msg.guild_id ? "guild" : undefined
            }

            // Build inbound message
            return {
              context,
              sender,
              content: msg.content,
              media,
              sessionKey: "discord:" + msg.channel_id,
              channel: "discord",
              senderId: msg.author.id,
              chatId: msg.channel_id,
              messageId: msg.id
            }
          })()

          // Fire-and-forget with error handling
          if (self.bus) {
            Effect.runFork(
              self.bus.publish(inbound).pipe(
                Effect.catch((error: unknown) => Effect.sync(() => {
                  log.error("failed to publish inbound message", { error: String(error) })
                }))
              )
            )
          }
        }
        break
      }
      default:
        log.debug("unhandled gateway event", { event })
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, intervalMs)
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ op: 1, d: this.sequence }))
    }
  }

  private scheduleReconnect(): void {
    const self = this
    if (!self.connected) return

    self.reconnectAttempts++
    const maxAttempts = 5
    const delay = Math.min(1000 * 2 ** (self.reconnectAttempts - 1), 30_000)

    log.info("scheduling gateway reconnect", {
      attempt: self.reconnectAttempts,
      delay
    })

    if (self.reconnectAttempts > maxAttempts) {
      log.error("max reconnect attempts reached, giving up", { maxAttempts })
      return
    }

    setTimeout(() => {
      if (self.connected && !self.gatewayReady) {
        self.connectGateway()
      }
    }, delay)
  }

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

export * as DiscordPlugin from "./discord-plugin"
