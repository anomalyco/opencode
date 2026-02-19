import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { findAssistantMessages } from "@opencode-ai/ui/find-assistant-messages"

function user(id: string): Message {
  return {
    id,
    role: "user",
    sessionID: "session-1",
    time: { created: 1 },
  } as unknown as Message
}

function assistant(id: string, parentID: string): Message {
  return {
    id,
    role: "assistant",
    sessionID: "session-1",
    parentID,
    time: { created: 1 },
  } as unknown as Message
}

describe("findAssistantMessages", () => {
  test("normal ordering: assistant after user in array → found via forward scan", () => {
    const messages = [user("u1"), assistant("a1", "u1")]
    const result = findAssistantMessages(messages, 0, "u1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  test("clock skew: assistant before user in array → found via backward scan", () => {
    // When client clock is ahead, user ID sorts after assistant ID,
    // so assistant appears earlier in the ID-sorted message array
    const messages = [assistant("a1", "u1"), user("u1")]
    const result = findAssistantMessages(messages, 1, "u1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  test("no assistant messages → returns empty array", () => {
    const messages = [user("u1"), user("u2")]
    const result = findAssistantMessages(messages, 0, "u1")
    expect(result).toHaveLength(0)
  })

  test("multiple assistant messages with matching parentID → all found", () => {
    const messages = [user("u1"), assistant("a1", "u1"), assistant("a2", "u1")]
    const result = findAssistantMessages(messages, 0, "u1")
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("a1")
    expect(result[1].id).toBe("a2")
  })

  test("does not return assistant messages with different parentID", () => {
    const messages = [user("u1"), assistant("a1", "u1"), assistant("a2", "other")]
    const result = findAssistantMessages(messages, 0, "u1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  test("stops forward scan at next user message", () => {
    const messages = [user("u1"), assistant("a1", "u1"), user("u2"), assistant("a2", "u1")]
    const result = findAssistantMessages(messages, 0, "u1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  test("stops backward scan at previous user message", () => {
    const messages = [assistant("a0", "u1"), user("u0"), assistant("a1", "u1"), user("u1")]
    const result = findAssistantMessages(messages, 3, "u1")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("a1")
  })

  test("invalid index returns empty array", () => {
    const messages = [user("u1")]
    expect(findAssistantMessages(messages, -1, "u1")).toHaveLength(0)
    expect(findAssistantMessages(messages, 5, "u1")).toHaveLength(0)
  })
})
