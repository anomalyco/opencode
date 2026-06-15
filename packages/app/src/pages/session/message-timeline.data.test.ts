import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Timeline } from "./message-timeline.data"

const sessionID = "ses_test"

const userMessage = {
  id: "msg_user",
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "openai", modelID: "gpt" },
} satisfies UserMessage

const assistantMessage = {
  id: "msg_assistant",
  sessionID,
  role: "assistant",
  time: { created: 2, completed: 3 },
  parentID: userMessage.id,
  modelID: "gpt",
  providerID: "openai",
  mode: "chat",
  agent: "build",
  path: { cwd: "/", root: "/" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
} satisfies AssistantMessage

const textPart = (id: string, text: string) =>
  ({
    id,
    sessionID,
    messageID: assistantMessage.id,
    type: "text",
    text,
  }) satisfies Part

const reasoningPart = (id: string, text: string) =>
  ({
    id,
    sessionID,
    messageID: assistantMessage.id,
    type: "reasoning",
    text,
    time: { start: 2 },
  }) satisfies Part

function constructRows(parts: Part[]) {
  return Timeline.constructMessageRows(
    userMessage,
    (messageID) => (messageID === assistantMessage.id ? parts : []),
    [assistantMessage],
    0,
    true,
    "idle",
    false,
  )
}

describe("Timeline.constructMessageRows", () => {
  test("does not collapse assistant text into reasoning preamble", () => {
    const rows = constructRows([
      reasoningPart("prt_reasoning", "thinking"),
      textPart("prt_progress", "Working on it."),
      textPart("prt_final", "Final answer."),
    ])

    expect(rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPart", "AssistantPart", "AssistantPart"])
  })

  test("collapses non-text preamble before the only assistant text", () => {
    const rows = constructRows([reasoningPart("prt_reasoning", "thinking"), textPart("prt_final", "Final answer.")])

    expect(rows.map((row) => row._tag)).toEqual(["UserMessage", "AssistantPreamble", "AssistantPart"])
    const preamble = rows[1]
    if (preamble?._tag !== "AssistantPreamble") throw new Error("expected assistant preamble row")
    expect(preamble.groups.map((group) => group.key)).toEqual([`part:${assistantMessage.id}:prt_reasoning`])
  })
})
