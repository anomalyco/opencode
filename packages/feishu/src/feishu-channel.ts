import type { LarkChannel, LarkChannelOptions, NormalizedMessage } from "@larksuiteoapi/node-sdk"
import type { GatewayTask } from "./store"

export type NormalizedFeishuMessage = {
  chatType: "direct" | "group"
  chatID: string
  senderID: string
  senderName?: string
  messageID: string
  threadID?: string
  rootID?: string
  originalText: string
  promptText: string
  replyTarget: string
  replyRootID?: string
}

export type NormalizeResult =
  | { kind: "accepted"; message: NormalizedFeishuMessage }
  | { kind: "ignored"; reason: "unmentioned_group" | "unsupported" | "empty" | "bot_message" }

export type FeishuReplyResult =
  | { kind: "delivered"; externalReplyID: string }
  | { kind: "not_sent"; retryable: boolean; reason: string }
  | { kind: "uncertain"; reason: string }

export type FeishuPort = {
  start(onMessage: (message: NormalizedFeishuMessage) => Promise<void>): Promise<void>
  send(task: GatewayTask, text: string): Promise<FeishuReplyResult>
  stop(): Promise<void>
}

export type FeishuChannelHandlers = {
  message?: (message: NormalizedMessage) => void | Promise<void>
  error?: (error: unknown) => void
  reconnecting?: () => void
  reconnected?: () => void
}

export type FeishuChannelClient = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  on(handlers: FeishuChannelHandlers): () => void
  send(
    to: string,
    input: { text: string },
    options?: {
      replyTo?: string
      replyInThread?: boolean
      mentions?: Array<{
        key: string
        openId?: string
        userId?: string
        name?: string
        isBot?: boolean
      }>
    },
  ): Promise<{ messageId: string }>
}
export type FeishuChannelOptions = LarkChannelOptions

export function normalizeChannelMessage(message: NormalizedMessage): NormalizeResult {
  if (message.rawContentType !== "text" || !message.messageId || !message.chatId || !message.senderId)
    return { kind: "ignored", reason: "unsupported" }
  if (isBotMessage(message.raw)) return { kind: "ignored", reason: "bot_message" }
  if (!message.content.trim()) return { kind: "ignored", reason: "empty" }
  if (message.chatType === "group" && !message.mentionedBot) return { kind: "ignored", reason: "unmentioned_group" }

  const routing = {
    chatID: message.chatId,
    senderID: message.senderId,
    ...(message.senderName ? { senderName: message.senderName } : {}),
    messageID: message.messageId,
    originalText: readOriginalText(message),
    promptText: message.content,
    replyTarget: message.chatId,
  }
  if (message.chatType === "p2p") return { kind: "accepted", message: { chatType: "direct", ...routing } }

  return {
    kind: "accepted",
    message: {
      chatType: "group",
      ...routing,
      ...(message.threadId ? { threadID: message.threadId } : {}),
      ...(message.rootId ? { rootID: message.rootId } : {}),
      replyRootID: message.rootId ?? message.messageId,
    },
  }
}

export async function createFeishuChannelPort(
  config: { appID: string; appSecret: string },
  input: {
    createChannel?: (options: FeishuChannelOptions) => FeishuChannelClient
    observe?: (event: string) => void
  } = {},
): Promise<FeishuPort> {
  const options: FeishuChannelOptions = {
    appId: config.appID,
    appSecret: config.appSecret,
    transport: "websocket",
    includeRawEvent: true,
    policy: {
      dmMode: "open",
      requireMention: true,
      respondToMentionAll: false,
    },
    source: "opencode-feishu",
  }
  const channel = input.createChannel
    ? input.createChannel(options)
    : await import("@larksuiteoapi/node-sdk").then((sdk) => adaptOfficialChannel(sdk.createLarkChannel(options)))
  const unsubscribers: Array<() => void> = []

  return {
    async start(onMessage) {
      unsubscribers.push(
        channel.on({
          async message(message) {
            const normalized = normalizeChannelMessage(message)
            if (normalized.kind === "accepted") await onMessage(normalized.message)
          },
          error: () => input.observe?.("channel_error"),
          reconnecting: () => input.observe?.("channel_reconnecting"),
          reconnected: () => input.observe?.("channel_reconnected"),
        }),
      )
      await channel.connect().then(
        () => input.observe?.("channel_connected"),
        () => {
          unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe())
          throw new Error("Feishu WebSocket connection failed")
        },
      )
    },
    send(task, text) {
      const options = {
        ...(task.replyRootID ? { replyTo: task.replyRootID, replyInThread: true } : {}),
        ...(task.replyMentionID
          ? {
              mentions: [
                {
                  key: task.replyMentionID,
                  openId: task.replyMentionID,
                  ...(task.replyMentionName ? { name: task.replyMentionName } : {}),
                },
              ],
            }
          : {}),
      }
      return channel
        .send(task.replyTarget, { text }, Object.keys(options).length ? options : undefined)
        .then(
          (result) => ({ kind: "delivered" as const, externalReplyID: result.messageId }),
          (error) => classifySendError(error),
        )
    },
    async stop() {
      unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe())
      await channel.disconnect()
      input.observe?.("channel_disconnected")
    },
  }
}

function adaptOfficialChannel(channel: LarkChannel): FeishuChannelClient {
  return {
    connect: () => channel.connect(),
    disconnect: () => channel.disconnect(),
    on: (handlers) => channel.on(handlers),
    send: (to, input, options) => channel.send(to, input, options),
  }
}

function classifySendError(error: unknown): FeishuReplyResult {
  const code = readErrorCode(error)
  if (code === "rate_limited") return { kind: "not_sent", retryable: true, reason: code }
  if (
    code === "format_error" ||
    code === "target_revoked" ||
    code === "permission_denied" ||
    code === "upload_failed" ||
    code === "ssrf_blocked"
  )
    return { kind: "not_sent", retryable: false, reason: code }
  return { kind: "uncertain", reason: code }
}

function readErrorCode(error: unknown) {
  if (!isRecord(error)) return "unknown"
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : "unknown"
}

function readOriginalText(message: NormalizedMessage) {
  if (!isRecord(message.raw)) return message.content
  const rawMessage = Reflect.get(message.raw, "message")
  if (!isRecord(rawMessage)) return message.content
  const content = Reflect.get(rawMessage, "content")
  if (typeof content !== "string") return message.content

  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) return message.content
    const text = Reflect.get(parsed, "text")
    return typeof text === "string" ? text : message.content
  } catch {
    return message.content
  }
}

function isBotMessage(raw: unknown) {
  if (!isRecord(raw)) return false
  const sender = Reflect.get(raw, "sender")
  if (!isRecord(sender)) return false
  const type = Reflect.get(sender, "sender_type")
  return type === "app" || type === "bot"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
