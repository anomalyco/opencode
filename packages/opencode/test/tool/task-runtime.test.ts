import { describe, expect, it } from "bun:test"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { resolveAgentType, validateTaskResult } from "../../src/tool/task-runtime"

const sessionID = SessionID.make("ses_task_test")
const messageID = MessageID.make("msg_task_test")

function makeTextPart(text: string) {
  return {
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "text" as const,
    text,
  }
}

function makeToolPart() {
  return {
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "tool" as const,
    callID: "call_123",
    tool: "bash",
    state: {
      status: "completed" as const,
      input: {},
      output: "done",
      title: "Run bash",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
}

describe("tool.task-runtime", () => {
  it("prefers subagent_type over alias fields", () => {
    const resolved = resolveAgentType({
      subagent_type: "general",
      agent: "reviewer",
      agent_type: "writer",
    })

    expect(resolved).toBe("general")
  })

  it("accepts agent when subagent_type is omitted", () => {
    const resolved = resolveAgentType({
      agent: "reviewer",
      agent_type: "writer",
    })

    expect(resolved).toBe("reviewer")
  })

  it("accepts agent_type when it is the only selector", () => {
    const resolved = resolveAgentType({
      agent_type: "writer",
    })

    expect(resolved).toBe("writer")
  })

  it("marks blank text-only task results as retryable", () => {
    const validation = validateTaskResult({
      info: {} as never,
      parts: [makeTextPart("   ")],
    })

    expect(validation.valid).toBe(false)
    expect(validation.retryable).toBe(true)
  })

  it("does not retry blank results after tool activity", () => {
    const validation = validateTaskResult({
      info: {} as never,
      parts: [makeToolPart(), makeTextPart("   ")],
    })

    expect(validation.valid).toBe(false)
    expect(validation.retryable).toBe(false)
  })

  it("returns trimmed output text when present", () => {
    const validation = validateTaskResult({
      info: {} as never,
      parts: [makeTextPart("intermediate"), makeTextPart(" final result ")],
    })

    expect(validation.valid).toBe(true)
    if (validation.valid) {
      expect(validation.outputText).toBe("final result")
    }
  })
})
