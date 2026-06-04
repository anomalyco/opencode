import type { MediaPart } from "./media"

// ---------------------------------------------------------------------------
// Chat type — distinguishes direct messages from group contexts
// ---------------------------------------------------------------------------

export type ChatType = "private" | "group" | "supergroup" | "channel"

// ---------------------------------------------------------------------------
// SenderInfo — structured sender identity with canonical ID
// ---------------------------------------------------------------------------

export interface SenderInfo {
  /** Platform name: "telegram", "discord", "slack", "whatsapp", "email", "teams" */
  readonly platform: string
  /** Raw platform-specific user ID */
  readonly platformId: string
  /** Canonical format: "platform:platformId" — e.g. "telegram:123456" */
  readonly canonicalId: string
  /** Username / handle (platform-specific) */
  readonly username?: string
  /** Display name / display name */
  readonly displayName?: string
}

// ---------------------------------------------------------------------------
// InboundContext — platform-agnostic normalized routing metadata
// ---------------------------------------------------------------------------

export interface InboundContext {
  /** Channel plugin type: "telegram", "discord", etc. */
  readonly channel: string
  /** Account/team/workspace ID (platform-specific) */
  readonly accountId?: string
  /** Chat/conversation ID — the "room" the message came from */
  readonly chatId: string
  /** Chat type classification */
  readonly chatType: ChatType
  /** Forum topic / thread ID (composite: "chatId/topicId") */
  readonly topicId?: string
  /** Space: guild (Discord), workspace (Slack), tenant (Teams) */
  readonly spaceId?: string
  /** Space type: "guild" | "workspace" | "tenant" */
  readonly spaceType?: string
  /** Sender of the message */
  readonly senderId: string
  /** Message ID on the platform */
  readonly messageId: string
  /** Whether the bot was mentioned in this message */
  readonly mentioned: boolean
  /** Reply-to message ID (for threaded conversations) */
  readonly replyToMessageId?: string
  /** Reply-to sender ID */
  readonly replyToSenderId?: string
  /** Raw platform-specific metadata */
  readonly raw?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// InboundMessage — the full normalized inbound message envelope
// ---------------------------------------------------------------------------

export interface InboundMessage {
  /** Normalized routing metadata */
  readonly context: InboundContext
  /** Structured sender identity */
  readonly sender: SenderInfo
  /** Text content of the message */
  readonly content: string
  /** Media attachments received (paths or URLs) */
  readonly media: ReadonlyArray<MediaPart>
  /** Session key for conversation persistence */
  readonly sessionKey: string
  /** Convenience mirrors from context */
  readonly channel: string
  readonly senderId: string
  readonly chatId: string
  readonly messageId: string
}
