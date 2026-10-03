import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { Controller } from "../../src/model-race/controller"
import { options } from "../../src/model-race/config"
import type { Candidate } from "../../src/model-race/types"

const candidate = (id: string): Candidate => ({
  id,
  label: id,
  providerID: "test",
  modelID: id,
})

const configured = options({
  strategy: { firstToken: true, throughput: true, toolCall: true },
  throughput: { warmupTokens: 0, measurementWindowMs: 1000 },
  switch: { enabled: true },
})

describe("model race controller", () => {
  test("selects the first token as provisional leader", () => {
    const controller = new Controller([candidate("a"), candidate("b")], configured, 0)

    controller.observe("a", LLMEvent.textDelta({ id: "a-text", text: "hello" }), 20)
    controller.observe("b", LLMEvent.textDelta({ id: "b-text", text: "hello" }), 30)

    expect(controller.leader()?.id).toBe("a")
  })

  test("switches from a fast first token to a faster sustained model", () => {
    const controller = new Controller([candidate("a"), candidate("b")], configured, 0)

    controller.observe("a", LLMEvent.textDelta({ id: "a-text", text: "a" }), 0)
    controller.observe("b", LLMEvent.textDelta({ id: "b-text", text: "b" }), 0)
    controller.observe("a", LLMEvent.textDelta({ id: "a-text", text: "a" }), 1000)
    controller.observe("b", LLMEvent.textDelta({ id: "b-text", text: "b".repeat(400) }), 1000)

    expect(controller.leader()?.id).toBe("b")
  })

  test("locks a complete tool call immediately", () => {
    const controller = new Controller([candidate("a"), candidate("b")], configured, 0)

    controller.observe("a", LLMEvent.toolInputDelta({ id: "call-a", name: "read", text: "{" }), 10)
    controller.observe("b", LLMEvent.toolCall({ id: "call-b", name: "read", input: { filePath: "a" } }), 20)
    controller.observe("a", LLMEvent.finish({ reason: "stop" }), 30)

    expect(controller.winner()).toEqual({ candidate: candidate("b"), reason: "tool-call" })
  })

  test("does not lock on a partial tool call", () => {
    const controller = new Controller([candidate("a"), candidate("b")], configured, 0)

    controller.observe("a", LLMEvent.toolInputStart({ id: "call-a", name: "read" }), 10)
    controller.observe("a", LLMEvent.toolInputDelta({ id: "call-a", name: "read", text: '{"filePath":' }), 20)

    expect(controller.winner()).toBeUndefined()
  })

  test("falls back when the provisional leader fails", () => {
    const controller = new Controller([candidate("a"), candidate("b")], configured, 0)

    controller.observe("a", LLMEvent.textDelta({ id: "a-text", text: "a" }), 10)
    controller.fail("a")
    controller.observe("b", LLMEvent.textDelta({ id: "b-text", text: "b" }), 20)

    expect(controller.leader()?.id).toBe("b")
  })
})
