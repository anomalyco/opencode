import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/sdk/v2"
import { isDefaultTitle, lastAssistantWithUsage } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("tracks usage across undo and redo boundaries", () => {
    const assistant = (id: string, input: number): SessionMessageInfo => ({
      id,
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [],
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0 },
    })
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(lastAssistantWithUsage(messages, "msg_a")?.tokens.input).toBe(10)
    expect(lastAssistantWithUsage(messages, "msg_missing")).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })
})
