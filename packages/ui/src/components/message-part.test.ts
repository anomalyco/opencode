import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, ReasoningPart, TextPart, ToolPart } from "@opencode-ai/sdk/v2"
import { groupParts, reasoningPartStreaming } from "./message-part-order"
import { skillText } from "./message-skill"
import { activeStreamingAssistantMessageID, hold, streamsplit } from "./message-part-stream"

function text(part: Partial<TextPart> = {}): TextPart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "value",
    ...part,
  }
}

function reasoning(part: Partial<ReasoningPart> = {}): ReasoningPart {
  return {
    id: "part_reasoning",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "thinking",
    time: { start: 1 },
    ...part,
  }
}

function tool(part: Partial<ToolPart> = {}): ToolPart {
  return {
    id: "part_tool",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state: {
      status: "completed",
      input: {},
      output: "",
      title: "bash",
      metadata: {},
      time: { start: 1, end: 2 },
    },
    ...part,
  }
}

function assistant(completed?: number): AssistantMessage {
  return {
    id: "msg_1",
    sessionID: "ses_1",
    role: "assistant",
    time: completed === undefined ? { created: 1 } : { created: 1, completed },
    parentID: "msg_user",
    modelID: "model_1",
    providerID: "provider_1",
    agent: "agent_1",
    mode: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

describe("message-part groupParts", () => {
  const isContextGroupTool = () => false

  test("renders reasoning before text within the same assistant segment", () => {
    const groups = groupParts(
      [
        { messageID: "msg_1", part: text({ id: "part_text" }) },
        { messageID: "msg_1", part: reasoning({ id: "part_reasoning" }) },
      ],
      isContextGroupTool,
    )

    expect(groups.map((group) => group.key)).toEqual(["part:msg_1:part_reasoning", "part:msg_1:part_text"])
  })

  test("does not move reasoning across tool boundaries", () => {
    const groups = groupParts(
      [
        { messageID: "msg_1", part: text({ id: "part_text" }) },
        { messageID: "msg_1", part: tool({ id: "part_tool" }) },
        { messageID: "msg_1", part: reasoning({ id: "part_reasoning" }) },
      ],
      isContextGroupTool,
    )

    expect(groups.map((group) => group.key)).toEqual([
      "part:msg_1:part_text",
      "part:msg_1:part_tool",
      "part:msg_1:part_reasoning",
    ])
  })

  test("does not move reasoning across message boundaries", () => {
    const groups = groupParts(
      [
        { messageID: "msg_1", part: text({ id: "part_text_1", messageID: "msg_1" }) },
        { messageID: "msg_2", part: reasoning({ id: "part_reasoning_2", messageID: "msg_2" }) },
      ],
      isContextGroupTool,
    )

    expect(groups.map((group) => group.key)).toEqual(["part:msg_1:part_text_1", "part:msg_2:part_reasoning_2"])
  })
})

describe("message-part reasoningPartStreaming", () => {
  test("uses the reasoning part end time before the assistant completion time", () => {
    expect(reasoningPartStreaming(reasoning(), assistant())).toBe(true)
    expect(reasoningPartStreaming(reasoning({ time: { start: 1, end: 2 } }), assistant())).toBe(false)
  })

  test("treats incomplete reasoning as stopped once the assistant completes", () => {
    expect(reasoningPartStreaming(reasoning(), assistant(3))).toBe(false)
  })
})

describe("message-part skillText", () => {
  test("returns synthetic skill template text", () => {
    const parts: Part[] = [
      text({ text: "user input" }),
      text({
        id: "part_2",
        text: "skill template",
        synthetic: true,
        metadata: { kind: "skill-template" },
      }),
    ]

    expect(skillText(parts)?.text).toBe("skill template")
  })

  test("ignores unrelated synthetic text", () => {
    const parts: Part[] = [
      text({
        id: "part_2",
        text: 'Called the Read tool with the following input: {"filePath":"/tmp/x"}',
        synthetic: true,
      }),
    ]

    expect(skillText(parts)).toBeUndefined()
  })
})

describe("message-part streamsplit", () => {
  test("keeps completed paragraphs in the stable head", () => {
    expect(streamsplit("Alpha $$x^2$$\n\nBeta")).toEqual({
      head: "Alpha $$x^2$$",
      tail: "Beta",
    })
  })

  test("keeps completed fenced blocks in the stable head", () => {
    expect(streamsplit("```ts\nconst x = 1\n```\nnext")).toEqual({
      head: "```ts\nconst x = 1\n```",
      tail: "next",
    })
  })

  test("leaves unfinished streaming text in the tail", () => {
    expect(streamsplit("Alpha $$x^2$$")).toEqual({
      head: "",
      tail: "Alpha $$x^2$$",
    })
  })

  test("holds tiny heading markers in the tail", () => {
    expect(hold("Alpha\n\n##")).toEqual({
      head: "",
      tail: "Alpha\n\n##",
    })
  })

  test("holds tiny visible tails until they are substantial", () => {
    expect(hold("Alpha\n\nBeta")).toEqual({
      head: "",
      tail: "Alpha\n\nBeta",
    })
  })

  test("splits again once the tail is substantial", () => {
    expect(hold("Alpha $$x^2$$\n\nBeta with enough text")).toEqual({
      head: "Alpha $$x^2$$",
      tail: "Beta with enough text",
    })
  })
})

describe("message-part activeStreamingAssistantMessageID", () => {
  test("returns only the latest incomplete assistant message", () => {
    expect(
      activeStreamingAssistantMessageID([
        assistant(2),
        { ...assistant(), id: "msg_active_1", time: { created: 3 } },
        { ...assistant(), id: "msg_active_2", time: { created: 4 } },
      ]),
    ).toBe("msg_active_2")
  })

  test("returns undefined when all assistant messages are completed", () => {
    expect(activeStreamingAssistantMessageID([assistant(2), { ...assistant(3), id: "msg_2" }])).toBeUndefined()
  })
})
