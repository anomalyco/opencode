import { describe, expect, test } from "bun:test"
import { Session, SessionMessage } from "@opencode-ai/sdk-next"
import { deriveGatewayIdentity } from "../src/identity"

describe("gateway identity", () => {
  test("maps the same direct chat and sender to one stable session", async () => {
    const input = {
      chatType: "direct" as const,
      chatID: "oc_direct_1",
      senderID: "ou_user_1",
      messageID: "om_message_1",
    }

    const first = await deriveGatewayIdentity(input)
    const second = await deriveGatewayIdentity({ ...input, messageID: "om_message_2" })
    const repeated = await deriveGatewayIdentity(input)

    expect(first.conversationID).toBe(second.conversationID)
    expect(first.sessionID).toBe(second.sessionID)
    expect(first.promptMessageID).not.toBe(second.promptMessageID)
    expect(first).toEqual(repeated)
    expect(() => Session.ID.make(first.sessionID)).not.toThrow()
    expect(() => SessionMessage.ID.make(first.promptMessageID)).not.toThrow()
  })

  test("isolates direct chats by chat and sender", async () => {
    const base = {
      chatType: "direct" as const,
      chatID: "oc_direct_1",
      senderID: "ou_user_1",
      messageID: "om_message_1",
    }
    const otherChat = await deriveGatewayIdentity({ ...base, chatID: "oc_direct_2" })
    const otherSender = await deriveGatewayIdentity({ ...base, senderID: "ou_user_2" })
    const original = await deriveGatewayIdentity(base)

    expect(otherChat.sessionID).not.toBe(original.sessionID)
    expect(otherSender.sessionID).not.toBe(original.sessionID)
  })

  test("uses thread, root, then message fallback for group routing", async () => {
    const base = {
      chatType: "group" as const,
      chatID: "oc_group_1",
      senderID: "ou_user_1",
      messageID: "om_message_1",
    }
    const thread = await deriveGatewayIdentity({ ...base, threadID: "omt_thread_1", rootID: "om_root_ignored" })
    const sameThread = await deriveGatewayIdentity({
      ...base,
      messageID: "om_message_2",
      threadID: "omt_thread_1",
      rootID: "om_other_root",
    })
    const root = await deriveGatewayIdentity({ ...base, rootID: "om_root_1" })
    const sameRoot = await deriveGatewayIdentity({ ...base, messageID: "om_message_2", rootID: "om_root_1" })
    const fallback = await deriveGatewayIdentity(base)
    const otherFallback = await deriveGatewayIdentity({ ...base, messageID: "om_message_2" })

    expect(thread.sessionID).toBe(sameThread.sessionID)
    expect(root.sessionID).toBe(sameRoot.sessionID)
    expect(fallback.sessionID).not.toBe(otherFallback.sessionID)
  })

  test("isolates group threads by group and root", async () => {
    const original = await deriveGatewayIdentity({
      chatType: "group",
      chatID: "oc_group_1",
      senderID: "ou_user_1",
      messageID: "om_message_1",
      threadID: "omt_thread_1",
    })
    const otherGroup = await deriveGatewayIdentity({
      chatType: "group",
      chatID: "oc_group_2",
      senderID: "ou_user_1",
      messageID: "om_message_1",
      threadID: "omt_thread_1",
    })
    const otherThread = await deriveGatewayIdentity({
      chatType: "group",
      chatID: "oc_group_1",
      senderID: "ou_user_1",
      messageID: "om_message_1",
      threadID: "omt_thread_2",
    })

    expect(otherGroup.sessionID).not.toBe(original.sessionID)
    expect(otherThread.sessionID).not.toBe(original.sessionID)
  })

  test("never exposes raw external identifiers in persistent identities", async () => {
    const identity = await deriveGatewayIdentity({
      chatType: "direct",
      chatID: "raw-chat-canary",
      senderID: "raw-sender-canary",
      messageID: "raw-message-canary",
    })

    expect(Object.values(identity).join(" ")).not.toContain("raw-")
    expect(identity.sessionID).toMatch(/^ses_feishu_[a-f0-9]{48}$/)
    expect(identity.promptMessageID).toMatch(/^msg_feishu_[a-f0-9]{48}$/)
    expect(identity.conversationID).toMatch(/^conv_[a-f0-9]{48}$/)
    expect(identity.taskID).toMatch(/^task_[a-f0-9]{48}$/)
    expect(identity.turnID).toMatch(/^turn_[a-f0-9]{48}$/)
    expect(identity.traceID).toMatch(/^trace_[a-f0-9]{48}$/)
  })
})
