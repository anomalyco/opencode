import { describe, expect, test } from "bun:test"
import { assistantLifecycleFlow } from "../scenarios/responses/assistant-lifecycle"
import { questionLifecycleFlow } from "../scenarios/tools/question-lifecycle"

describe("response and question executable flows", () => {
  test("exports the assistant lifecycle states in execution order", () => {
    expect(assistantLifecycleFlow.states.map((state) => state.address)).toEqual([
      "assistant-lifecycle/assistant-response-succeeded",
      "assistant-lifecycle/assistant-response-failed",
      "assistant-lifecycle/assistant-response-interrupted",
    ])
  })

  test("exports the question lifecycle states in execution order", () => {
    expect(questionLifecycleFlow.states.map((state) => state.address)).toEqual([
      "question-lifecycle/question-input-streaming",
      "question-lifecycle/question-awaiting-form",
      "question-lifecycle/question-review",
      "question-lifecycle/question-succeeded",
      "question-lifecycle/question-denied",
    ])
  })

  test("uses distinct terminal states for each lifecycle", () => {
    expect(assistantLifecycleFlow.states.map((state) => state.metadata.screen.states)).toEqual([
      "success",
      "error",
      "error",
    ])
    expect(questionLifecycleFlow.states.at(-1)?.metadata.screen.states).toBe("error")
  })
})
