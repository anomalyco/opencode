import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "../src/promise"
import { assistantUsageState, lastAssistantWithUsage } from "../src/solid/usage"

const assistant = (id: string, input: number): SessionMessageInfo => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("lastAssistantWithUsage", () => {
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
      time: { created: 0 },
    }

    const messages = [assistant("msg_before", 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })
})

describe("assistantUsageState", () => {
  const compaction: SessionMessageInfo = {
    id: "msg_compaction",
    type: "compaction",
    status: "completed",
    reason: "manual",
    summary: "Current state",
    recent: "",
    time: { created: 0 },
  }

  test("keeps an unloaded undo boundary unknown rather than empty", () => {
    expect(assistantUsageState([assistant("msg_before", 30), compaction], "msg_missing")).toEqual({
      message: undefined,
      unmeasured: true,
    })
    expect(assistantUsageState([], "msg_missing").unmeasured).toBe(true)
    expect(assistantUsageState([]).unmeasured).toBe(false)
  })

  test("shares completed compaction and loaded undo boundaries with the measurement", () => {
    const before = assistant("msg_before", 30)
    const after = assistant("msg_after", 5)
    const messages = [before, compaction, after]

    expect(assistantUsageState(messages, compaction.id)).toEqual({ message: before, unmeasured: false })
    expect(assistantUsageState(messages, after.id)).toEqual({ message: undefined, unmeasured: true })
    expect(assistantUsageState(messages)).toEqual({ message: after, unmeasured: false })
  })
})
