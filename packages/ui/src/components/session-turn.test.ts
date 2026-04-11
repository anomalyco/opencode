import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2"
import { hiddenReasoning } from "./session-turn-state"

function assistant(id: string): AssistantMessage {
  return {
    id,
    sessionID: "ses_1",
    parentID: "msg_user",
    role: "assistant",
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "gpt-5.4",
    providerID: "openai",
    time: { created: 1, completed: 2 },
  }
}

function reasoning(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "reasoning",
    text: "Planning task execution",
    time: { start: 1, end: 2 },
  }
}

function text(id: string, messageID: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "text",
    text: "visible reply",
  }
}

describe("session-turn hiddenReasoning", () => {
  test("detects completed reasoning-only assistant turns when summaries are hidden", () => {
    const msg = assistant("msg_assistant")

    expect(hiddenReasoning([msg], { [msg.id]: [reasoning("part_reasoning", msg.id)] }, false)).toBe(true)
  })

  test("ignores hidden reasoning when summaries are enabled", () => {
    const msg = assistant("msg_assistant")

    expect(hiddenReasoning([msg], { [msg.id]: [reasoning("part_reasoning", msg.id)] }, true)).toBe(false)
  })

  test("ignores assistant turns without reasoning parts", () => {
    const msg = assistant("msg_assistant")

    expect(hiddenReasoning([msg], { [msg.id]: [text("part_text", msg.id)] }, false)).toBe(false)
  })
})
