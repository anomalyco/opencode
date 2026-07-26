import { describe, expect, test } from "bun:test"
import type { ModelInfo, SessionMessageInfo } from "@opencode-ai/client"
import { contextUsage, isDefaultTitle, lastAssistantWithUsage } from "../../src/util/session"

const assistant = (id: string, input: number): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("tracks usage across undo and redo boundaries", () => {
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(lastAssistantWithUsage(messages, "msg_a")?.tokens.input).toBe(10)
    expect(lastAssistantWithUsage(messages, "msg_missing")).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const compaction: SessionMessageInfo = {
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Current state",
      recent: "",
      time: { created: 0 },
    }
    const messages = [assistant("msg_before", 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })

  test("reports usage against the effective input window", () => {
    const models = [
      {
        id: "model",
        providerID: "provider",
        limit: { context: 400_000, input: 272_000, output: 128_000 },
      } as unknown as ModelInfo,
    ]

    expect(contextUsage([assistant("msg_input_limit", 252_000)], models)).toEqual({
      tokens: 252_000,
      percent: 93,
    })
  })
})
