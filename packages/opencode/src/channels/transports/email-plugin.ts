import { Effect, Schema } from "effect"
import type { Channel, ChannelHealth, ChannelCapabilities } from "../contracts/channel"
import type { MessageSender } from "../contracts/sender"
import type { MediaSender, MediaPart } from "../contracts/media"
import type { InboundContext, InboundMessage, SenderInfo, ChatType } from "../contracts/inbound"
import { buildCanonicalId } from "../contracts/identity"
import type { Interface as MessageBus } from "../runtime/bus"
import * as Log from "@opencode-ai/core/util/log"
import nodemailer from "nodemailer"

const log = Log.create({ service: "channels/email" })

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface EmailConfig {
  readonly smtpHost: string
  readonly smtpPort: number
  readonly smtpSecure?: boolean
  readonly smtpUser?: string
  readonly smtpPass?: string
  readonly fromAddress: string
  readonly fromName?: string
}

// ---------------------------------------------------------------------------
// Tagged error for SMTP failures (used with Effect.catchTag)
// ---------------------------------------------------------------------------

class EmailError extends Schema.TaggedErrorClass<EmailError>()("EmailError", {
  operation: Schema.String,
  detail: Schema.String
}) {}

// ---------------------------------------------------------------------------
// Email Channel Implementation
// ---------------------------------------------------------------------------

export class EmailChannel implements Channel, MessageSender, MediaSender {
  readonly id: string
  readonly type = "email"
  readonly name: string

  private config: EmailConfig
  private connected = false
  private startTime = 0
  private lastMessageTime = 0
  private transporter: nodemailer.Transporter | undefined
  private bus: MessageBus | undefined

  constructor(id: string, name: string, config: EmailConfig) {
    this.id = id
    this.name = name
    this.config = config
  }

  // -------------------------------------------------------------------------
  // Channel interface
  // -------------------------------------------------------------------------

  start(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("starting email channel", { id: self.id, name: self.name })

      self.transporter = nodemailer.createTransport({
        host: self.config.smtpHost,
        port: self.config.smtpPort,
        secure: self.config.smtpSecure ?? false,
        auth:
          self.config.smtpUser && self.config.smtpPass
            ? { user: self.config.smtpUser, pass: self.config.smtpPass }
            : undefined
      })

      // Verify SMTP connection — measures latency
      const verifyStart = Date.now()
      yield* Effect.tryPromise({
        try: () => self.transporter!.verify(),
        catch: (error) =>
          new EmailError({
            operation: "start",
            detail: `SMTP verify failed: ${String(error)}`
          })
      })
      const latency = Date.now() - verifyStart

      self.connected = true
      self.startTime = Date.now()
      log.info("email channel connected", {
        id: self.id,
        host: self.config.smtpHost,
        port: self.config.smtpPort,
        latency
      })
    }).pipe(
      Effect.catchTag("EmailError", (error) =>
        Effect.gen(function* () {
          log.error("failed to start email channel", { id: self.id, error: error.detail })
          return yield* Effect.die(error)
        })
      )
    )
  }

  stop(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      log.info("stopping email channel", { id: self.id })

      if (self.transporter) {
        self.transporter.close()
        self.transporter = undefined
      }

      self.connected = false
      log.info("email channel stopped", { id: self.id })
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
      if (!self.transporter) {
        return yield* new EmailError({
          operation: "send",
          detail: "email channel not started — no transporter"
        })
      }

      log.info("sending email", { to: channelId, messageLength: message.length })

      yield* Effect.tryPromise({
        try: () =>
          self.transporter!.sendMail({
            from: self.config.fromName
              ? `${self.config.fromName} <${self.config.fromAddress}>`
              : self.config.fromAddress,
            to: channelId,
            subject: `Message from ${self.name}`,
            html: message,
            text: message
          }),
        catch: (error) =>
          new EmailError({
            operation: "send",
            detail: `sendMail failed: ${String(error)}`
          })
      })

      self.lastMessageTime = Date.now()
      log.info("email sent", { to: channelId })
    }).pipe(
      Effect.catchTag("EmailError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send email", { to: channelId, error: error.detail })
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
      if (!self.transporter) {
        return yield* new EmailError({
          operation: "sendMedia",
          detail: "email channel not started — no transporter"
        })
      }

      log.info("sending email with attachments", { to: channelId, count: media.length })

      const attachments = media.map((part, i) => ({
        filename: part.filename ?? `attachment_${i}`,
        content: Buffer.from(new Uint8Array(part.data)),
        contentType: part.mimeType ?? self.inferMimeType(part.type)
      }))

      yield* Effect.tryPromise({
        try: () =>
          self.transporter!.sendMail({
            from: self.config.fromName
              ? `${self.config.fromName} <${self.config.fromAddress}>`
              : self.config.fromAddress,
            to: channelId,
            subject: `Message with attachments from ${self.name}`,
            html: "",
            text: "",
            attachments
          }),
        catch: (error) =>
          new EmailError({
            operation: "sendMedia",
            detail: `sendMail with attachments failed: ${String(error)}`
          })
      })

      self.lastMessageTime = Date.now()
      log.info("email with attachments sent", { to: channelId, count: media.length })
    }).pipe(
      Effect.catchTag("EmailError", (error) =>
        Effect.gen(function* () {
          log.error("failed to send email with attachments", {
            to: channelId,
            error: error.detail
          })
          return yield* Effect.die(error)
        })
      )
    )
  }

  // -------------------------------------------------------------------------
  // Inbound — hook for future IMAP integration
  // -------------------------------------------------------------------------

  setBus(bus: MessageBus): void {
    this.bus = bus
  }

  handleInboundEmail(email: {
    from: string
    to: string
    subject: string
    text: string
    html?: string
  }): Effect.Effect<void, never, never> {
    const self = this
    return Effect.gen(function* () {
      if (!self.bus) {
        log.warn("handleInboundEmail called but no bus attached — call setBus() first")
        return yield* Effect.void
      }

      const platformId = email.from
      const canonicalId = buildCanonicalId("email", platformId)
      const messageId = `email-${Date.now()}-${platformId}`

      const sender: SenderInfo = {
        platform: "email",
        platformId,
        canonicalId,
        displayName: platformId
      }

      const context: InboundContext = {
        channel: "email",
        chatId: email.to,
        chatType: "private" as ChatType,
        senderId: canonicalId,
        messageId,
        mentioned: false,
        raw: { subject: email.subject }
      }

      const content = email.text || email.html || ""
      const sessionKey = `email:${email.from}`

      const message: InboundMessage = {
        context,
        sender,
        content,
        media: [],
        sessionKey,
        channel: "email",
        senderId: canonicalId,
        chatId: email.to,
        messageId
      }

      log.info("inbound email received", {
        from: email.from,
        to: email.to,
        subject: email.subject,
        sessionKey
      })

      yield* self.bus.publish(message)
    })
  }

  // -------------------------------------------------------------------------
  // Private helpers
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

export * as EmailPlugin from "./email-plugin"
