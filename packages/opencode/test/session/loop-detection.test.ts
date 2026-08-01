import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LoopDetection } from "../../src/session/loop-detection"
import { PartID, SessionID, MessageID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_loop_test")
const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test")

function user(): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "user",
      sessionID,
      time: { created: Date.now() },
      model: { providerID, modelID },
      agent: "build",
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text: "fix the build" }],
  }
}

function shellFail(command: string, exit: number): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      sessionID,
      parentID: MessageID.ascending(),
      time: { created: Date.now() },
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      modelID,
      providerID,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID,
        type: "tool",
        callID: `call_${id}`,
        tool: "bash",
        state: {
          status: "completed",
          input: { command },
          output: `failed with exit ${exit}`,
          metadata: { exit },
          title: command,
          time: { start: Date.now(), end: Date.now() },
        },
      },
    ],
  }
}

describe("session.loop-detection", () => {
  test("does not inject when the same command failed only once", () => {
    const msgs = [user(), shellFail("bun test", 1)]
    LoopDetection.apply(msgs)
    const parts = msgs[0].parts
    expect(parts.some((part) => part.type === "text" && part.synthetic)).toBe(false)
  })

  test("injects a synthetic hint when the same command failed twice", () => {
    const msgs = [user(), shellFail("bun test", 1), shellFail("bun test", 1)]
    LoopDetection.apply(msgs)
    const hint = msgs[0].parts.findLast((part) => part.type === "text" && part.synthetic)
    expect(hint).toBeDefined()
    expect(hint?.type).toBe("text")
    expect((hint as SessionV1.TextPart).text).toContain("The same command has failed 2 times")
    expect((hint as SessionV1.TextPart).text).toContain("bun test")
  })

  test("does not re-inject on subsequent steps", () => {
    const msgs = [user(), shellFail("bun test", 1), shellFail("bun test", 1)]
    LoopDetection.apply(msgs)
    const countAfterFirst = msgs[0].parts.filter((part) => part.type === "text" && part.synthetic).length
    LoopDetection.apply(msgs)
    const countAfterSecond = msgs[0].parts.filter((part) => part.type === "text" && part.synthetic).length
    expect(countAfterFirst).toBe(1)
    expect(countAfterSecond).toBe(1)
  })

  test("ignores successful shell commands", () => {
    const msgs = [user(), shellFail("bun test", 0), shellFail("bun test", 0)]
    LoopDetection.apply(msgs)
    expect(msgs[0].parts.some((part) => part.type === "text" && part.synthetic)).toBe(false)
  })

  test("tracks each command independently", () => {
    const msgs = [user(), shellFail("bun test a", 1), shellFail("bun test b", 1)]
    LoopDetection.apply(msgs)
    expect(msgs[0].parts.some((part) => part.type === "text" && part.synthetic)).toBe(false)
  })

  test("does nothing when there is no user message", () => {
    const msgs = [shellFail("bun test", 1), shellFail("bun test", 1)]
    LoopDetection.apply(msgs)
    expect(msgs.length).toBe(2)
  })
})
