import { describe, expect, test } from "bun:test"
import {
  createFeishuChannelPort,
  type FeishuChannelClient,
  type FeishuChannelHandlers,
  type FeishuChannelOptions,
  normalizeChannelMessage,
} from "../src/feishu-channel"
import type { NormalizedMessage } from "@larksuiteoapi/node-sdk"

describe("Feishu Channel adapter", () => {
  test("accepts direct text and preserves the complete original text", () => {
    expect(
      normalizeChannelMessage(
        message({
          content: "你好",
          raw: rawText("你好"),
        }),
      ),
    ).toEqual({
      kind: "accepted",
      message: {
        chatType: "direct",
        chatID: "oc_chat_1",
        senderID: "ou_user_1",
        messageID: "om_message_1",
        originalText: "你好",
        promptText: "你好",
        replyTarget: "oc_chat_1",
      },
    })
  })

  test("accepts only mentioned group text and keeps the raw mention in original text", () => {
    expect(
      normalizeChannelMessage(
        message({
          chatType: "group",
          content: "查库存",
          mentionedBot: true,
          rootId: "om_root_1",
          threadId: "omt_thread_1",
          raw: rawText("@_user_2 查库存"),
        }),
      ),
    ).toEqual({
      kind: "accepted",
      message: {
        chatType: "group",
        chatID: "oc_chat_1",
        senderID: "ou_user_1",
        messageID: "om_message_1",
        threadID: "omt_thread_1",
        rootID: "om_root_1",
        originalText: "@_user_2 查库存",
        promptText: "查库存",
        replyTarget: "oc_chat_1",
        replyRootID: "om_root_1",
      },
    })

    expect(normalizeChannelMessage(message({ chatType: "group", mentionedBot: false }))).toEqual({
      kind: "ignored",
      reason: "unmentioned_group",
    })
  })

  test("ignores unsupported, empty, and bot-authored messages", () => {
    expect(normalizeChannelMessage(message({ rawContentType: "image" }))).toEqual({
      kind: "ignored",
      reason: "unsupported",
    })
    expect(normalizeChannelMessage(message({ content: " \n " }))).toEqual({
      kind: "ignored",
      reason: "empty",
    })
    expect(normalizeChannelMessage(message({ raw: rawText("你好", "app") }))).toEqual({
      kind: "ignored",
      reason: "bot_message",
    })
  })

  test("uses the current group message when no root exists", () => {
    const result = normalizeChannelMessage(message({ chatType: "group", mentionedBot: true, rootId: undefined }))
    expect(result.kind).toBe("accepted")
    if (result.kind !== "accepted") throw new Error("Expected accepted group message")
    expect(result.message).toEqual(
      expect.objectContaining({
        replyRootID: "om_message_1",
      }),
    )
  })

  test("configures WebSocket, open direct chats, required group mentions, and connection observation", async () => {
    const fake = new FakeChannel()
    let options: FeishuChannelOptions | undefined
    const observed: string[] = []
    const received: unknown[] = []
    const port = await createFeishuChannelPort(
      { appID: "cli_test", appSecret: "secret-canary" },
      {
        createChannel(value) {
          options = value
          return fake
        },
        observe(event) {
          observed.push(event)
        },
      },
    )

    await port.start(async (value) => {
      received.push(value)
    })
    await fake.emitMessage(message())
    fake.emitReconnecting()
    fake.emitReconnected()
    await port.stop()

    expect(options).toEqual({
      appId: "cli_test",
      appSecret: "secret-canary",
      transport: "websocket",
      includeRawEvent: true,
      policy: {
        dmMode: "open",
        requireMention: true,
        respondToMentionAll: false,
      },
      source: "opencode-feishu",
    })
    expect(received).toHaveLength(1)
    expect(observed).toEqual(["channel_connected", "channel_reconnecting", "channel_reconnected", "channel_disconnected"])
    expect(fake.connects).toBe(1)
    expect(fake.disconnects).toBe(1)
  })

  test("maps confirmed and uncertain send outcomes conservatively", async () => {
    const delivered = new FakeChannel()
    delivered.sendResult = { messageId: "om_reply_1" }
    const deliveredPort = await createFeishuChannelPort(
      { appID: "cli_test", appSecret: "secret-canary" },
      { createChannel: () => delivered },
    )
    expect(await deliveredPort.send(task(), "完整回答")).toEqual({
      kind: "delivered",
      externalReplyID: "om_reply_1",
    })
    expect(delivered.lastSend).toEqual({
      to: "oc_chat_1",
      input: { text: "完整回答" },
      options: { replyTo: "om_root_1", replyInThread: true },
    })

    const retryable = new FakeChannel()
    retryable.sendError = { code: "rate_limited", message: "secret-canary" }
    const retryablePort = await createFeishuChannelPort(
      { appID: "cli_test", appSecret: "secret-canary" },
      { createChannel: () => retryable },
    )
    expect(await retryablePort.send(task(), "完整回答")).toEqual({
      kind: "not_sent",
      retryable: true,
      reason: "rate_limited",
    })

    const uncertain = new FakeChannel()
    uncertain.sendError = { code: "send_timeout", message: "secret-canary" }
    const uncertainPort = await createFeishuChannelPort(
      { appID: "cli_test", appSecret: "secret-canary" },
      { createChannel: () => uncertain },
    )
    expect(await uncertainPort.send(task(), "完整回答")).toEqual({
      kind: "uncertain",
      reason: "send_timeout",
    })
  })

  test("sanitizes handshake failures before they leave the adapter", async () => {
    const fake = new FakeChannel()
    fake.connectError = new Error("credential secret-canary rejected")
    const port = await createFeishuChannelPort(
      { appID: "cli_test", appSecret: "secret-canary" },
      { createChannel: () => fake },
    )

    await expect(port.start(async () => undefined)).rejects.toThrow("Feishu WebSocket connection failed")
    await expect(port.start(async () => undefined)).rejects.not.toThrow("secret-canary")
  })
})

class FakeChannel implements FeishuChannelClient {
  connects = 0
  disconnects = 0
  connectError?: Error
  sendError?: unknown
  sendResult = { messageId: "om_reply_default" }
  lastSend?: { to: string; input: { text: string }; options?: { replyTo?: string; replyInThread?: boolean } }
  handlers: FeishuChannelHandlers = {}

  on(handlers: FeishuChannelHandlers) {
    this.handlers = handlers
    return () => {
      this.handlers = {}
    }
  }

  async connect() {
    this.connects++
    if (this.connectError) throw this.connectError
  }

  async disconnect() {
    this.disconnects++
  }

  async send(to: string, input: { text: string }, options?: { replyTo?: string; replyInThread?: boolean }) {
    this.lastSend = { to, input, options }
    if (this.sendError) throw this.sendError
    return this.sendResult
  }

  async emitMessage(value: NormalizedMessage) {
    await this.handlers.message?.(value)
  }

  emitReconnecting() {
    this.handlers.reconnecting?.()
  }

  emitReconnected() {
    this.handlers.reconnected?.()
  }
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: "om_message_1",
    chatId: "oc_chat_1",
    chatType: "p2p",
    senderId: "ou_user_1",
    content: "你好",
    rawContentType: "text",
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: 1_700_000_000_000,
    raw: rawText("你好"),
    ...overrides,
  }
}

function rawText(text: string, senderType = "user") {
  return {
    sender: { sender_type: senderType },
    message: { content: JSON.stringify({ text }) },
  }
}

function task() {
  return {
    id: "task_1",
    externalMessageHash: "hash_1",
    conversationID: "conv_1",
    sessionID: "ses_feishu_1",
    promptMessageID: "msg_feishu_1",
    turnID: "turn_1",
    traceID: "trace_1",
    promptText: "你好",
    originalText: "你好",
    replyTarget: "oc_chat_1",
    replyRootID: "om_root_1",
    state: "answered" as const,
    answer: "完整回答",
    receiveSequence: 1,
    sendAttempts: 0,
  }
}
