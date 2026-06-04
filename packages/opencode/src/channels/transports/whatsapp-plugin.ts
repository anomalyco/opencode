import { Effect, Schema } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import type { TypingCapable } from "../contracts/typing"
import type { ReactionCapable } from "../contracts/reactions"
import type { MediaSender, MediaPart } from "../contracts/media"
import type { InboundContext, InboundMessage, SenderInfo, ChatType } from "../contracts/inbound"
import { buildCanonicalId } from "../contracts/identity"
import type { Interface as MessageBus } from "../runtime/bus"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels/whatsapp" })

interface WhatsAppConfig {
  readonly phoneNumberId: string
  readonly accessToken: string
  readonly graphApiVersion?: string
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API inbound webhook payload
// ---------------------------------------------------------------------------

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: "text" | "image" | "video" | "audio" | "document" | "sticker"
  text?: { body: string }
  image?: { id: string; mime_type: string }
  video?: { id: string; mime_type: string }
  audio?: { id: string; mime_type: string }
  document?: { id: string; mime_type: string; filename: string }
  context?: { from: string; id: string }
}

interface WhatsAppInboundEvent {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: string
        metadata: { display_phone_number: string; phone_number_id: string }
        contacts?: Array<{ wa_id: string; profile: { name: string } }>
        messages?: Array<WhatsAppMessage>
      }
    }>
  }>
}

// ---------------------------------------------------------------------------
// Tagged error for WhatsApp API failures (used with Effect.catchTag)
// ---------------------------------------------------------------------------

class WhatsAppApiError extends Schema.TaggedErrorClass<WhatsAppApiError>()("WhatsAppApiError", {
  statusCode: Schema.Number,
  detail: Schema.String
}) {}

// ---------------------------------------------------------------------------
// WhatsApp Channel Implementation
// ---------------------------------------------------------------------------

export class WhatsAppChannel
  implements Channel, MessageSender, TypingCapable, ReactionCapable, MediaSender
{
  readonly id: string
  readonly type = "whatsapp"
  readonly name: string

  private config: WhatsAppConfig
  private bus: MessageBus | undefined
  private connected = false
  private startTime = 0
  private lastMessageTime = 0
  private reconnectAttempts = 0
  private readonly abortController = new AbortController()

  constructor(id: string, name: string, config: WhatsAppConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  // -------------------------------------------------------------------------
  // Inbound message processing
  // -------------------------------------------------------------------------

  setBus(bus: MessageBus): void {
    this.bus = bus
  }

  handleWebhook(body: WhatsAppInboundEvent): void {
    const self = this
    if (body.object !== "whatsapp_business_account") return

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const messages = change.value.messages ?? []
        for (const msg of messages) {
          self.handleWhatsAppMessage(msg, change.value)
        }
      }
    }
  }

  private handleWhatsAppMessage(
    msg: WhatsAppMessage,
    value: WhatsAppInboundEvent["entry"][0]["changes"][0]["value"]
  ): void {
    const self = this
    if (!self.bus) {
      log.warn("whatsapp inbound message received but bus not configured", { messageId: msg.id })
      return
    }

    const senderPhone = msg.from
    const canonicalId = buildCanonicalId("whatsapp", senderPhone)

    // Determine chat type — WhatsApp doesn't expose group info in the
    // messages webhook, but the contact profile and metadata can hint at it.
    // For now, classify as "private" unless the sender is not in contacts
    // (group messages have no contact profile in the payload).
    const chatType: ChatType = value.contacts?.length ? "private" : "group"

    // Build sender info from contacts if available
    const contact = value.contacts?.find((c) => c.wa_id === senderPhone)
    const senderInfo: SenderInfo = {
      platform: "whatsapp",
      platformId: senderPhone,
      canonicalId,
      displayName: contact?.profile.name
    }

    // Extract text content
    let content = ""
    if (msg.type === "text" && msg.text) {
      content = msg.text.body
    } else if (msg.type) {
      content = `[${msg.type}]`
    }

    // Build reply context if present
    const replyToMessageId = msg.context?.id
    const replyToSenderId = msg.context?.from
      ? buildCanonicalId("whatsapp", msg.context.from)
      : undefined

    // Use sender phone as chatId for private, or metadata phone_number_id for group
    const chatId = chatType === "private" ? senderPhone : value.metadata.phone_number_id
    const messageId = msg.id

    const context: InboundContext = {
      channel: "whatsapp",
      accountId: value.metadata.phone_number_id,
      chatId,
      chatType,
      senderId: canonicalId,
      messageId,
      mentioned: content.includes(`@${value.metadata.display_phone_number}`),
      replyToMessageId,
      replyToSenderId,
      raw: msg as unknown as Record<string, unknown>
    }

    const inbound: InboundMessage = {
      context,
      sender: senderInfo,
      content,
      media: [],
      sessionKey: `whatsapp:${chatId}`,
      channel: "whatsapp",
      senderId: canonicalId,
      chatId,
      messageId
    }

    log.info("whatsapp inbound message published", {
      messageId,
      senderPhone,
      chatType,
      contentType: msg.type
    })

    // Fire-and-forget publish
    Effect.runFork(self.bus.publish(inbound))
  }

  // -------------------------------------------------------------------------
  // Channel interface
  // -------------------------------------------------------------------------

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting whatsapp channel", { id: self.id, name: self.name })

      // Validate access token by fetching phone number info
      const info = yield* self.apiFetchJson<{ verified_name: string }>(
        `/${self.config.phoneNumberId}`
      )
      self.connected = true
      self.startTime = Date.now()
      log.info("whatsapp access token validated", {
        id: self.id,
        verifiedName: info.verified_name
      })

      log.info("whatsapp channel started", { id: self.id })
    }).pipe(
      Effect.catchTag("WhatsAppApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start whatsapp channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping whatsapp channel", { id: self.id })
      self.abortController.abort()
      self.connected = false
      log.info("whatsapp channel stopped", { id: self.id })
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
      editing: false,
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
      log.info("sending whatsapp message", { channelId, messageLength: message.length })

      yield* self.apiFetch(`/${self.config.phoneNumberId}/messages`, "POST", {
        messaging_product: "whatsapp",
        to: channelId,
        type: "text",
        text: { body: message }
      })

      self.lastMessageTime = Date.now()
      log.info("whatsapp message sent", { channelId })
    }).pipe(
      Effect.catchTag("WhatsAppApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send whatsapp message", { channelId, error: error.detail })
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
      log.info("sending typing indicator", { channelId })

      // WhatsApp Cloud API does not expose a dedicated typing presence endpoint.
      // The best approximation is to send a typing presence update via the messages
      // endpoint. If the call fails (e.g. unsupported), log and continue — the
      // sender should still proceed with the real message.
      yield* self.apiFetch(`/${self.config.phoneNumberId}/messages`, "POST", {
        messaging_product: "whatsapp",
        to: channelId,
        typing: true
      })

      log.info("typing indicator sent", { channelId })

      // WhatsApp typing indicators are ephemeral — no explicit stop needed
      return () => {
        log.debug("typing indicator stop called (expires naturally)", { channelId })
      }
    }).pipe(
      Effect.catchTag("WhatsAppApiError", (error) =>
        Effect.gen(function* () {
          log.warn("typing indicator not supported, continuing", { channelId, error: error.detail })
          return () => {
            log.debug("typing indicator stop called (no-op since send failed)", { channelId })
          }
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
      log.info("adding reaction", { channelId, messageId, emoji })

      yield* self.apiFetch(`/${self.config.phoneNumberId}/messages`, "POST", {
        messaging_product: "whatsapp",
        to: channelId,
        type: "reaction",
        reaction: { message_id: messageId, emoji }
      })

      log.info("reaction added", { channelId, messageId, emoji })
    }).pipe(
      Effect.catchTag("WhatsAppApiError", (error) =>
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
      log.info("sending whatsapp media", { channelId, count: media.length })

      for (const part of media) {
        // Step 1: Upload the media to WhatsApp to obtain a media ID
        const mediaId = yield* self.uploadMedia(part)

        // Step 2: Send a message referencing the uploaded media ID
        const mediaType = part.type === "audio" ? "audio" : part.type

        const payload: Record<string, unknown> = {
          messaging_product: "whatsapp",
          to: channelId,
          type: mediaType,
          [mediaType]: { id: mediaId }
        }

        // Attach caption only for types that support it
        if (part.filename && (mediaType === "image" || mediaType === "video" || mediaType === "document")) {
          ;(payload[mediaType] as Record<string, unknown>).caption = part.filename
        }

        // Attach filename for documents
        if (mediaType === "document" && part.filename) {
          ;(payload[mediaType] as Record<string, unknown>).filename = part.filename
        }

        yield* self.apiFetch(`/${self.config.phoneNumberId}/messages`, "POST", payload)

        log.debug("whatsapp media part sent", { channelId, mediaType, mediaId })
      }

      self.lastMessageTime = Date.now()
      log.info("whatsapp media sent", { channelId, count: media.length })
    }).pipe(
      Effect.catchTag("WhatsAppApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send whatsapp media", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // Private: Upload media to WhatsApp Media API
  // -------------------------------------------------------------------------

  private uploadMedia(part: MediaPart): Effect.Effect<string, WhatsAppApiError> {
    const self = this
    return Effect.gen(function* () {
      const mimeType = part.mimeType ?? self.inferMimeType(part.type)
      const filename = part.filename ?? `file_${part.type}`
      const blob = new Blob([new Uint8Array(part.data)], { type: mimeType })

      const formData = new FormData()
      formData.append("file", blob, filename)
      formData.append("messaging_product", "whatsapp")
      formData.append("type", mimeType)

      log.debug("uploading whatsapp media", { type: part.type, mimeType, filename })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(
            `https://graph.facebook.com/${self.config.graphApiVersion ?? "v18.0"}/${self.config.phoneNumberId}/media`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${self.config.accessToken}`
              },
              body: formData,
              signal: self.abortController.signal
            }
          ),
        catch: (error) =>
          new WhatsAppApiError({ statusCode: 0, detail: `network error uploading media: ${String(error)}` })
      })

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new WhatsAppApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("whatsapp media upload failed", { status: response.status, body: errorBody })
        return yield* Effect.fail(
          new WhatsAppApiError({ statusCode: response.status, detail: `media upload failed: ${errorBody}` })
        )
      }

      const result = yield* Effect.tryPromise({
        try: () => response.json() as Promise<{ id: string }>,
        catch: () => new WhatsAppApiError({ statusCode: 0, detail: "failed to parse media upload response" })
      })

      log.debug("whatsapp media uploaded", { mediaId: result.id })
      return result.id
    })
  }

  // -------------------------------------------------------------------------
  // Private: REST API helpers
  // -------------------------------------------------------------------------

  private apiFetch(
    path: string,
    method: string,
    body?: unknown
  ): Effect.Effect<void, WhatsAppApiError> {
    const self = this
    return Effect.gen(function* () {
      const baseUrl = `https://graph.facebook.com/${self.config.graphApiVersion ?? "v18.0"}`
      const url = `${baseUrl}${path}`
      const headers: Record<string, string> = {
        Authorization: `Bearer ${self.config.accessToken}`
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

      log.debug("whatsapp REST request", { method, path })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new WhatsAppApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryData = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ retry_after: number }>,
          catch: () => new WhatsAppApiError({ statusCode: 429, detail: "rate limited" })
        })
        const delayMs = Math.ceil((retryData.retry_after ?? 1) * 1000)
        log.warn("whatsapp rate limited, retrying after delay", { path, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new WhatsAppApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new WhatsAppApiError({
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
          catch: () => new WhatsAppApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("whatsapp API error", { method, path, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new WhatsAppApiError({ statusCode: response.status, detail: errorBody })
        )
      }
    })
  }

  private apiFetchJson<T = unknown>(
    path: string,
    method: string = "GET",
    body?: unknown
  ): Effect.Effect<T, WhatsAppApiError> {
    const self = this
    return Effect.gen(function* () {
      const baseUrl = `https://graph.facebook.com/${self.config.graphApiVersion ?? "v18.0"}`
      const url = `${baseUrl}${path}`
      const headers: Record<string, string> = {
        Authorization: `Bearer ${self.config.accessToken}`
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

      log.debug("whatsapp REST request", { method, path })

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) =>
          new WhatsAppApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      // Handle rate limits: 429 — extract Retry-After and retry once
      if (response.status === 429) {
        const retryData = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ retry_after: number }>,
          catch: () => new WhatsAppApiError({ statusCode: 429, detail: "rate limited" })
        })
        const delayMs = Math.ceil((retryData.retry_after ?? 1) * 1000)
        log.warn("whatsapp rate limited, retrying after delay", { path, delayMs })
        yield* Effect.sleep(`${delayMs} millis`)

        const retryResponse = yield* Effect.tryPromise({
          try: () => fetch(url, init),
          catch: (error) =>
            new WhatsAppApiError({
              statusCode: 0,
              detail: `network error on retry: ${String(error)}`
            })
        })

        if (!retryResponse.ok) {
          return yield* Effect.fail(
            new WhatsAppApiError({
              statusCode: retryResponse.status,
              detail: `retry failed: ${retryResponse.statusText}`
            })
          )
        }

        return (yield* Effect.tryPromise({
          try: () => retryResponse.json(),
          catch: () => new WhatsAppApiError({ statusCode: 0, detail: "failed to parse retry response" })
        })) as T
      }

      if (!response.ok) {
        const errorBody = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => new WhatsAppApiError({ statusCode: response.status, detail: response.statusText })
        })
        log.error("whatsapp API error", { method, path, status: response.status, body: errorBody })
        return yield* Effect.fail(
          new WhatsAppApiError({ statusCode: response.status, detail: errorBody })
        )
      }

      return (yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new WhatsAppApiError({ statusCode: 0, detail: "failed to parse response" })
      })) as T
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
        return "application/pdf"
    }
  }
}

export * as WhatsAppPlugin from "./whatsapp-plugin"
