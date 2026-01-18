import { describe, expect, test } from "bun:test"
import { OpenAIConversationState } from "../../src/session/openai-conversation"
import type { MessageV2 } from "../../src/session/message-v2"

describe("session.openai-conversation", () => {
  test("extracts latest OpenAI responseId from message parts", () => {
    const messages = [
      {
        info: { id: "m1", role: "user" },
        parts: [{ id: "p1", sessionID: "s", messageID: "m1", type: "text", text: "hi" }],
      },
      {
        info: { id: "m2", role: "assistant" },
        parts: [
          {
            id: "p2",
            sessionID: "s",
            messageID: "m2",
            type: "text",
            text: "hello",
            metadata: { openai: { responseId: "resp_123" } },
          },
        ],
      },
      {
        info: { id: "m3", role: "assistant" },
        parts: [
          {
            id: "p3",
            sessionID: "s",
            messageID: "m3",
            type: "tool",
            callID: "c1",
            tool: "bash",
            state: { status: "completed", input: {}, output: "", time: { start: 1, end: 2 } },
            metadata: { openai: { responseId: "resp_456" } },
          },
        ],
      },
    ] as any as MessageV2.WithParts[]

    expect(OpenAIConversationState.latestResponseId(messages)).toBe("resp_456")
  })

  test("strips responseId from part metadata but preserves other keys", () => {
    const part = {
      id: "p",
      sessionID: "s",
      messageID: "m",
      type: "text",
      text: "hello",
      metadata: {
        openai: {
          responseId: "resp_123",
          serviceTier: "default",
        },
        other: { x: 1 },
      },
    } as any as MessageV2.Part

    const stripped = OpenAIConversationState.stripResponseIdFromPart(part) as any
    expect(stripped.metadata.openai.responseId).toBeUndefined()
    expect(stripped.metadata.openai.serviceTier).toBe("default")
    expect(stripped.metadata.other.x).toBe(1)
  })
})

