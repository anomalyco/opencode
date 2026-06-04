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
import { markdownToTelegramHTML, markdownToTelegramMarkdownV2 } from "../runtime/formatting"
import * as Log from "@opencode-ai/core/util/log"
import type { Interface as MediaStore } from "../runtime/media-store"

const log = Log.create({ service: "channels/telegram" })

const TELEGRAM_API_BASE = "https://api.telegram.org"
// Telegram API types
interface TelegramConfig {
  readonly botToken: string
  readonly parseMode?: "MarkdownV2" | "HTML"
  readonly pollingEnabled?: boolean
  /** Telegram user IDs allowed to interact. Empty = allow all. */
  readonly allowedSenders?: ReadonlyArray<string>
}

interface TelegramApiResponse<T = unknown> {
  readonly ok: boolean
  readonly result?: T
  readonly error_code?: number
  readonly description?: string
}

interface TelegramBotInfo {
  readonly id: number
  readonly is_bot: boolean
  readonly first_name: string
  readonly username: string
}

interface TelegramUser {
  readonly id: number
  readonly is_bot?: boolean
  readonly first_name?: string
  readonly last_name?: string
  readonly username?: string
}

interface TelegramEntity {
  readonly type: string
  readonly offset: number
  readonly length: number
  readonly user?: TelegramUser
}

interface TelegramMessage {
  readonly message_id: number
  readonly chat: {
    readonly id: number
    readonly type: string // "private" | "group" | "supergroup" | "channel"
    readonly title?: string
  }
  readonly from?: TelegramUser
  readonly text?: string
  readonly caption?: string
  readonly date: number
  readonly entities?: ReadonlyArray<TelegramEntity>
  readonly reply_to_message?: TelegramMessage
  readonly photo?: ReadonlyArray<{ readonly file_id: string; readonly file_unique_id: string }>
  readonly voice?: { readonly file_id: string; readonly duration?: number }
  readonly audio?: { readonly file_id: string; readonly title?: string; readonly performer?: string }
  readonly document?: { readonly file_id: string; readonly file_name?: string; readonly mime_type?: string }
  readonly video?: { readonly file_id: string; readonly mime_type?: string }
  readonly sticker?: { readonly file_id: string; readonly emoji?: string }
}

interface TelegramUpdate {
  readonly update_id: number
  readonly message?: TelegramMessage
}

// Tagged error
class TelegramApiError extends Schema.TaggedErrorClass<TelegramApiError>()("TelegramApiError", {
  statusCode: Schema.Number,
  detail: Schema.String
}) {}


// Telegram Channel Implementation


export class TelegramChannel
  implements Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
{
  readonly id: string
  readonly type = "telegram"
  readonly name: string

  private config: TelegramConfig
  private bus: MessageBus | undefined
  private botUserId: number | undefined
  private connected = false
  private startTime = 0
  private lastMessageTime = 0
  private reconnectAttempts = 0
  private pollingOffset = 0
  private pollingAbort: AbortController | undefined
  private pollingTimer: ReturnType<typeof setTimeout> | undefined

  constructor(id: string, name: string, config: TelegramConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  /** Inject the message bus for inbound publishing */
  setBus(bus: MessageBus): void {
    this.bus = bus
  }

  
  // Channel interface
  

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting telegram channel", { id: self.id, name: self.name })

      const me = yield* self.apiFetchJson<TelegramBotInfo>("/getMe")
      self.botUserId = me.id
      self.connected = true
      self.startTime = Date.now()
      log.info("telegram bot token validated", { id: self.id, username: me.username, botId: me.id })

      if (self.config.pollingEnabled) {
        yield* self.startPolling()
      }

      log.info("telegram channel started", { id: self.id })
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start telegram channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping telegram channel", { id: self.id })
      self.pollingAbort?.abort()
      self.pollingAbort = undefined

      if (self.pollingTimer) {
        clearTimeout(self.pollingTimer)
        self.pollingTimer = undefined
      }

      self.connected = false
      self.pollingOffset = 0
      log.info("telegram channel stopped", { id: self.id })
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

  // MessageSender

  send(channelId: string, message: string): Effect.Effect<void, never, never> {
    const self = this
    const parseMode = self.config.parseMode ?? "HTML"
    return Effect.gen(function* () {
      log.info("sending telegram message", { channelId, messageLength: message.length })

      const formatted = self.formatContent(message)
      const chunks = self.splitMessage(formatted)

      for (const chunk of chunks) {
        yield* self.sendChunkWithFallback(channelId, chunk, parseMode, message)
      }

      self.lastMessageTime = Date.now()
      log.info("telegram message sent", { channelId, chunks: chunks.length })
    })
  }

  private sendChunkWithFallback(
    channelId: string,
    chunk: string,
    parseMode: "MarkdownV2" | "HTML",
    originalMessage: string,
  ): Effect.Effect<void, never, never> {
    const self = this
    const body: Record<string, unknown> = { chat_id: channelId, text: chunk, parse_mode: parseMode }
    return Effect.gen(function* () {
      yield* self.apiFetchJson("/sendMessage", body)
    }).pipe(
      Effect.catch((error: unknown) => {
        const detail = String((error as { detail?: string })?.detail ?? error).toLowerCase()
        if (detail.includes("can't parse") || detail.includes("bad request")) {
          log.warn("formatted message parse failed, retrying as plain text", { channelId })
          return self.sendChunkPlain(channelId, originalMessage)
        }
        log.error("failed to send telegram message", { channelId, error: detail })
        return Effect.void
      })
    )
  }

  private sendChunkPlain(channelId: string, text: string): Effect.Effect<void, never, never> {
    const self = this
    return Effect.gen(function* () {
      yield* self.apiFetchJson("/sendMessage", { chat_id: channelId, text })
    }).pipe(
      Effect.catch((error: unknown) => {
        log.error("failed to send plain telegram message", { channelId, error: String(error) })
        return Effect.void
      })
    )
  }

  // MessageEditor

  edit(channelId: string, messageId: string, content: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("editing telegram message", { channelId, messageId })

      const formatted = self.formatContent(content)
      const parseMode = self.config.parseMode ?? "HTML"
      const body: Record<string, unknown> = {
        chat_id: channelId,
        message_id: Number(messageId),
        text: formatted,
        parse_mode: parseMode,
      }

      yield* self.apiFetchJson("/editMessageText", body)

      log.info("telegram message edited", { channelId, messageId })
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to edit telegram message", { channelId, messageId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // TypingCapable

  startTyping(channelId: string): Effect.Effect<() => void> {
    const self = this
    return Effect.gen(function* () {
      yield* self.apiFetchJson("/sendChatAction", {
        chat_id: channelId,
        action: "typing"
      })

      return () => {
        log.debug("typing indicator stop called (expires naturally)", { channelId })
      }
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start typing indicator", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // ReactionCapable

  react(channelId: string, messageId: string, emoji: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      yield* self.apiFetchJson("/setMessageReaction", {
        chat_id: channelId,
        message_id: Number(messageId),
        reaction: [{ type: "emoji", emoji }]
      })

      log.info("reaction added", { channelId, messageId, emoji })
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to add reaction", { channelId, messageId, emoji, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

 // MediaSender

  sendMedia(channelId: string, media: MediaPart[]): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("sending telegram media", { channelId, count: media.length })

      for (let i = 0; i < media.length; i++) {
        const part = media[i]
        const filename = part.filename ?? `file_${i}`
        const mimeType = part.mimeType ?? self.inferMimeType(part.type)
        const blob = new Blob([new Uint8Array(part.data)], { type: mimeType })
        const endpoint = self.mediaOutboundEndpoint(part.type)
        const formData = new FormData()
        formData.append("chat_id", channelId)
        const fieldName = part.type === "image" ? "photo" : part.type === "video" ? "video" : part.type === "audio" ? "audio" : "document"
        formData.append(fieldName, blob, filename)

        const response = yield* Effect.tryPromise({
          try: () => {
            const url = `${TELEGRAM_API_BASE}/bot${self.config.botToken}${endpoint}`
            return fetch(url, { method: "POST", body: formData, signal: self.pollingAbort?.signal })
          },
          catch: (error) =>
            new TelegramApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
        })

        const json = (yield* Effect.tryPromise({
          try: () => response.json() as Promise<TelegramApiResponse>,
          catch: () => new TelegramApiError({ statusCode: response.status, detail: "failed to parse response" })
        })) as TelegramApiResponse

        if (!json.ok) {
          return yield* Effect.fail(
            new TelegramApiError({
              statusCode: json.error_code ?? response.status,
              detail: json.description ?? "unknown error"
            })
          )
        }
      }

      self.lastMessageTime = Date.now()
      log.info("telegram media sent", { channelId, count: media.length })
    }).pipe(
      Effect.catchTag("TelegramApiError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send telegram media", { channelId, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  /** Split a message respecting Telegram's 4096 character limit */
  private splitMessage(text: string, maxLen: number = 4096): string[] {
    if (text.length <= maxLen) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > maxLen) {
      const codeBlockStart = remaining.indexOf("```")
      const codeBlockEnd = codeBlockStart !== -1
        ? remaining.indexOf("```", codeBlockStart + 3) + 3
        : -1

      let splitAt = -1
      if (codeBlockStart !== -1 && codeBlockEnd > maxLen && codeBlockStart < maxLen) {
        splitAt = codeBlockStart > 0 ? codeBlockStart : maxLen
      }

      if (splitAt === -1) {
        const newlineIdx = remaining.lastIndexOf("\n", maxLen - 1)
        if (newlineIdx > maxLen * 0.5) splitAt = newlineIdx + 1
      }

      if (splitAt === -1) {
        const spaceIdx = remaining.lastIndexOf(" ", maxLen - 1)
        if (spaceIdx > maxLen * 0.5) splitAt = spaceIdx + 1
      }

      if (splitAt === -1 || splitAt <= 0) splitAt = maxLen

      chunks.push(remaining.slice(0, splitAt))
      remaining = remaining.slice(splitAt)
    }

    if (remaining.length > 0) chunks.push(remaining)
    return chunks
  }

  /** Format text per the configured parse mode (defaults to HTML) */
  private formatContent(text: string): string {
    if (this.config.parseMode === "MarkdownV2") {
      return markdownToTelegramMarkdownV2(text)
    }
    return markdownToTelegramHTML(text)
  }

  // Private: Inbound message processing

  private processInboundMessage(msg: TelegramMessage): void {
    const self = this
    if (!self.bus || !msg.from) return

    // Allowlist check
    if (self.config.allowedSenders && self.config.allowedSenders.length > 0) {
      const senderId = String(msg.from.id)
      const allowed = self.config.allowedSenders.some(
        (a) => a === senderId || a === `@${msg.from!.username}` || a === `telegram:${senderId}`
      )
      if (!allowed) {
        log.debug("message from non-allowed sender, skipping", { senderId })
        return
      }
    }

    // Build sender identity
    const platformId = String(msg.from.id)
    const sender: SenderInfo = {
      platform: "telegram",
      platformId,
      canonicalId: buildCanonicalId("telegram", platformId),
      username: msg.from.username,
      displayName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ")
    }

    // Determine chat type
    const chatType = self.mapChatType(msg.chat.type)

    // Detect mention
    const isMentioned = self.detectMention(msg)

    // Build content — strip @bot mentions from text
    let content = msg.text ?? msg.caption ?? ""
    if (isMentioned) {
      content = self.stripMention(content)
    }

    // Handle reply context
    let replyToMessageId: string | undefined
    let replyToSenderId: string | undefined
    if (msg.reply_to_message) {
      replyToMessageId = String(msg.reply_to_message.message_id)
      replyToSenderId = msg.reply_to_message.from ? String(msg.reply_to_message.from.id) : undefined
      const replyAuthor = msg.reply_to_message.from
        ? [msg.reply_to_message.from.first_name, msg.reply_to_message.from.last_name].filter(Boolean).join(" ")
        : "unknown"
      const replyContent = msg.reply_to_message.text ?? msg.reply_to_message.caption ?? "[media]"
      content = `[quoted ${replyAuthor}]: ${replyContent}\n\n${content}`
    }

    // Handle incoming media
    const mediaParts = self.extractInboundMedia(msg)

    // Build composite chat ID for forum topics
    const chatId = String(msg.chat.id)

    // Build inbound context
    const context: InboundContext = {
      channel: "telegram",
      chatId,
      chatType,
      senderId: platformId,
      messageId: String(msg.message_id),
      mentioned: isMentioned,
      replyToMessageId,
      replyToSenderId,
      raw: { chatTitle: msg.chat.title }
    }

    // Build inbound message
    const inbound: InboundMessage = {
      context,
      sender,
      content,
      media: mediaParts,
      sessionKey: `telegram:${chatId}`,
      channel: "telegram",
      senderId: platformId,
      chatId,
      messageId: String(msg.message_id)
    }

    // Publish to bus (fire-and-forget from the polling loop)
    const fiber = Effect.runFork(
      self.bus.publish(inbound).pipe(
        Effect.catch((error: unknown) => Effect.sync(() => {
          log.error("failed to publish inbound message", { error: String(error) })
        }))
      )
    )

    self.lastMessageTime = Date.now()
    log.info("inbound message published", {
      chatId,
      senderId: platformId,
      chatType,
      mentioned: isMentioned,
      contentLength: content.length,
      mediaCount: mediaParts.length
    })
  }

  private mapChatType(telegramType: string): ChatType {
    switch (telegramType) {
      case "private":
        return "private"
      case "group":
        return "group"
      case "supergroup":
        return "supergroup"
      case "channel":
        return "channel"
      default:
        return "group"
    }
  }

  private detectMention(msg: TelegramMessage): boolean {
    if (!msg.entities || !this.botUserId) return false

    for (const entity of msg.entities) {
      // @username mention
      if (entity.type === "mention" && entity.user?.id === this.botUserId) {
        return true
      }
      // text mention (for bots without username)
      if (entity.type === "text_mention" && entity.user?.id === this.botUserId) {
        return true
      }
      // /bot_command (e.g. /start@mybot)
      if (entity.type === "bot_command") {
        const text = msg.text ?? ""
        const cmdEnd = entity.offset + entity.length
        const afterCmd = text.slice(cmdEnd)
        if (afterCmd.startsWith(`@${this.getUsername()}`)) {
          return true
        }
      }
    }
    return false
  }

  private stripMention(text: string): string {
    const botUsername = this.getUsername()
    if (!botUsername) return text
    return text.replace(new RegExp(`@${botUsername}\\b`, "g"), "").trim()
  }

  /** Download a Telegram file and return the local path */
  private downloadFile(fileID: string): Effect.Effect<string, Error> {
    const self = this
    return Effect.gen(function* () {
      const fileInfo = yield* self.apiFetchJson<{ file_path?: string }>(
        "/getFile",
        { file_id: fileID },
      )

      if (!fileInfo.file_path) {
        return yield* Effect.fail(new Error(`Telegram file not found: ${fileID}`))
      }

      const url = `https://api.telegram.org/file/bot${self.config.botToken}/${fileInfo.file_path}`

      const response = yield* Effect.tryPromise({
        try: () => fetch(url),
        catch: (error) => new Error(`Failed to download telegram file: ${String(error)}`),
      })

      if (!response.ok) {
        return yield* Effect.fail(new Error(`Telegram file download failed: ${response.status}`))
      }

      const tmp = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"
      const filename = `${Date.now()}_${fileInfo.file_path.replace(/\//g, "_")}`
      const localPath = `${tmp}/opencode-channels-media/${filename}`

      yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(localPath, response)
        },
        catch: (error) => new Error(`Failed to write downloaded file: ${String(error)}`),
      })

      return localPath
    })
  }

  /** Extract inbound media using MediaStore for download + storage (Effect variant) */
  private extractInboundMediaWithStore(
    msg: TelegramMessage,
    mediaStore: MediaStore,
    scope: string,
  ): Effect.Effect<MediaPart[], never, never> {
    const self = this
    return Effect.gen(function* () {
      const parts: MediaPart[] = []

      const addMedia = function* (
        type: MediaPart["type"],
        fileID: string,
        filename: string,
        mimeType: string,
      ) {
        const result = yield* Effect.gen(function* () {
          const localPath = yield* self.downloadFile(fileID)
          const ref = yield* mediaStore.store(localPath, {
            filename,
            source: "telegram",
            cleanupPolicy: "delete_on_cleanup",
          }, scope)
          return { type, data: new Uint8Array(0), filename, mimeType, ref } as MediaPart
        }).pipe(
          Effect.catch((error: unknown) => {
            log.error("failed to download/store inbound media", { fileID, error: String(error) })
            return Effect.succeed(null)
          })
        )
        if (result) parts.push(result)
      }

      if (msg.photo && msg.photo.length > 0) {
        const largest = msg.photo[msg.photo.length - 1]
        yield* addMedia("image", largest.file_id, "photo.jpg", "image/jpeg")
      }

      if (msg.voice) {
        yield* addMedia("audio", msg.voice.file_id, "voice.ogg", "audio/ogg")
      }

      if (msg.audio) {
        const title = msg.audio.title ? `${msg.audio.title}.mp3` : "audio.mp3"
        yield* addMedia("audio", msg.audio.file_id, title, "audio/mpeg")
      }

      if (msg.video) {
        yield* addMedia("video", msg.video.file_id, "video.mp4", msg.video.mime_type ?? "video/mp4")
      }

      if (msg.document) {
        const docType: MediaPart["type"] = msg.document.mime_type?.startsWith("image/")
          ? "image"
          : msg.document.mime_type?.startsWith("video/")
            ? "video"
            : msg.document.mime_type?.startsWith("audio/")
              ? "audio"
              : "document"
        yield* addMedia(docType, msg.document.file_id, msg.document.file_name ?? "document", msg.document.mime_type ?? "application/octet-stream")
      }

      if (msg.sticker) {
        yield* addMedia("image", msg.sticker.file_id, "sticker.webp", "image/webp")
      }

      return parts
    })
  }

  private extractInboundMedia(msg: TelegramMessage): MediaPart[] {
    const parts: MediaPart[] = []

    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1]
      parts.push({ type: "image", data: new Uint8Array(0), filename: `file_id:${largest.file_id}`, mimeType: "image/jpeg" })
    }

    if (msg.voice) {
      parts.push({ type: "audio", data: new Uint8Array(0), filename: `file_id:${msg.voice.file_id}`, mimeType: "audio/ogg" })
    }

    if (msg.audio) {
      parts.push({ type: "audio", data: new Uint8Array(0), filename: msg.audio.title ?? `file_id:${msg.audio.file_id}`, mimeType: "audio/mpeg" })
    }

    if (msg.video) {
      parts.push({ type: "video", data: new Uint8Array(0), filename: `file_id:${msg.video.file_id}`, mimeType: msg.video.mime_type ?? "video/mp4" })
    }

    if (msg.document) {
      const docType: MediaPart["type"] = msg.document.mime_type?.startsWith("image/")
        ? "image"
        : msg.document.mime_type?.startsWith("video/")
          ? "video"
          : msg.document.mime_type?.startsWith("audio/")
            ? "audio"
            : "document"
      parts.push({ type: docType, data: new Uint8Array(0), filename: msg.document.file_name ?? `file_id:${msg.document.file_id}`, mimeType: msg.document.mime_type ?? "application/octet-stream" })
    }

    if (msg.sticker) {
      parts.push({ type: "image", data: new Uint8Array(0), filename: msg.sticker.emoji ?? "sticker", mimeType: "image/webp" })
    }

    return parts
  }

  private getUsername(): string {
    return this.botUserId ? String(this.botUserId) : ""
  }

  // Private: Long polling

  private startPolling(): Effect.Effect<void, TelegramApiError> {
    const self = this
    return Effect.gen(function* () {
      self.pollingAbort = new AbortController()
      log.info("starting telegram long polling", { id: self.id })
      self.pollOnce()
    })
  }

  private pollOnce(): void {
    const self = this
    if (!self.connected || self.pollingAbort?.signal.aborted) return

    const url = `${TELEGRAM_API_BASE}/bot${self.config.botToken}/getUpdates`

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset: self.pollingOffset, timeout: 30 }),
      signal: self.pollingAbort?.signal
    })
      .then((response) => response.json() as Promise<TelegramApiResponse<TelegramUpdate[]>>)
      .then((json) => {
        if (!json.ok) {
          log.error("telegram polling API error", { status: json.error_code, desc: json.description })
          self.reconnectAttempts++
          if (self.connected && !self.pollingAbort?.signal.aborted) {
            self.pollingTimer = setTimeout(() => self.pollOnce(), 1000)
          }
          return
        }

        const updates = json.result ?? []
        for (const update of updates) {
          self.pollingOffset = update.update_id + 1

          if (update.message) {
            self.processInboundMessage(update.message)
          }
        }

        if (self.connected && !self.pollingAbort?.signal.aborted) {
          self.pollingTimer = setTimeout(() => self.pollOnce(), 0)
        }
      })
      .catch((error) => {
        if (self.pollingAbort?.signal.aborted) return
        log.error("telegram polling error", { error: String(error) })
        self.reconnectAttempts++
        if (self.connected && !self.pollingAbort?.signal.aborted) {
          self.pollingTimer = setTimeout(() => self.pollOnce(), 1000)
        }
      })
  }

  // -------------------------------------------------------------------------
  // Private: API helpers
  // -------------------------------------------------------------------------

  private apiFetchJson<T = unknown>(
    method: string,
    body?: unknown
  ): Effect.Effect<T, TelegramApiError> {
    const self = this
    return Effect.gen(function* () {
      const url = `${TELEGRAM_API_BASE}/bot${self.config.botToken}${method}`
      const init: RequestInit = { method: body !== undefined ? "POST" : "GET" }
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" }
        init.body = JSON.stringify(body)
      }

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, init),
        catch: (error) => new TelegramApiError({ statusCode: 0, detail: `network error: ${String(error)}` })
      })

      const json = (yield* Effect.tryPromise({
        try: () => response.json() as Promise<TelegramApiResponse<T>>,
        catch: () => new TelegramApiError({ statusCode: response.status, detail: "failed to parse response" })
      })) as TelegramApiResponse<T>

      if (!json.ok) {
        return yield* Effect.fail(
          new TelegramApiError({
            statusCode: json.error_code ?? response.status,
            detail: json.description ?? "unknown error"
          })
        )
      }

      return json.result as T
    })
  }

  private mediaOutboundEndpoint(type: MediaPart["type"]): string {
    switch (type) {
      case "image": return "/sendPhoto"
      case "video": return "/sendVideo"
      case "audio": return "/sendAudio"
      case "document": return "/sendDocument"
    }
  }

  private inferMimeType(type: MediaPart["type"]): string {
    switch (type) {
      case "image": return "image/png"
      case "video": return "video/mp4"
      case "audio": return "audio/mpeg"
      case "document": return "application/octet-stream"
    }
  }
}

export * as TelegramPlugin from "./telegram-plugin"
