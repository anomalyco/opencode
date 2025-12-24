import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"

describe("MessageV2.toModelMessage", () => {
  const sid = "session_1"
  const mid = "message_1"
  const pid = "message_0"

  function assistant(parts: MessageV2.Part[]): MessageV2.WithParts {
    return {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        time: {
          created: 0,
        },
        parentID: pid,
        modelID: "gpt-5.2",
        providerID: "openai",
        mode: "chat",
        agent: "agent",
        path: {
          cwd: "/",
          root: "/",
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      },
      parts,
    }
  }

  function step(id: string): MessageV2.StepStartPart {
    return {
      id,
      sessionID: sid,
      messageID: mid,
      type: "step-start",
    }
  }

  function think(id: string): MessageV2.ReasoningPart {
    return {
      id,
      sessionID: sid,
      messageID: mid,
      type: "reasoning",
      text: "Let me think...",
      time: {
        start: 0,
      },
    }
  }

  function say(id: string): MessageV2.TextPart {
    return {
      id,
      sessionID: sid,
      messageID: mid,
      type: "text",
      text: "Answer",
    }
  }

  test("drops assistant messages with only reasoning/step-start parts when enabled", () => {
    const messages = [assistant([step("part_step"), think("part_reasoning")])]

    expect(MessageV2.toModelMessage(messages, { dropReasoningOnlyAssistantMessages: true })).toEqual([])
  })

  test("keeps assistant messages with only reasoning by default", () => {
    const messages = [assistant([think("part_reasoning")])]

    expect(MessageV2.toModelMessage(messages)).toHaveLength(1)
  })

  test("keeps assistant messages when non-reasoning content exists", () => {
    const messages = [assistant([think("part_reasoning"), say("part_text")])]

    const result = MessageV2.toModelMessage(messages)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe("assistant")
  })
})
