import { describe, expect, test } from "bun:test"
import { LLM, type LLMEvent } from "@opencode-ai/llm"
import { LLMNativeEvents } from "../../src/session/llm-native-events"

const types = (events: ReadonlyArray<{ readonly type: string }>) => events.map((event) => event.type)

describe("LLMNativeEvents", () => {
  test("synthesizes text and reasoning boundaries around native deltas", () => {
    const events = LLMNativeEvents.toSessionEvents([
      { type: "request-start", id: "req_1", model: LLM.model({ id: "gpt-5", provider: "openai", protocol: "openai-responses" }) },
      { type: "step-start", index: 0 },
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: "!" },
      { type: "reasoning-delta", text: "Thinking" },
      { type: "request-finish", reason: "stop", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ] satisfies ReadonlyArray<LLMEvent>)

    expect(types(events)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-delta",
      "reasoning-start",
      "reasoning-delta",
      "text-end",
      "reasoning-end",
      "finish-step",
      "finish",
    ])
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text)).toEqual(["Hello", "!"])
    expect(events.find((event) => event.type === "finish-step")).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    })
  })

  test("creates pending tool state before native tool-call events", () => {
    const events = LLMNativeEvents.toSessionEvents([
      { type: "tool-input-delta", id: "call_1", name: "lookup", text: '{"query"' },
      { type: "tool-input-delta", id: "call_1", name: "lookup", text: ':"weather"}' },
      { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
    ] satisfies ReadonlyArray<LLMEvent>)

    expect(types(events)).toEqual([
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
    ])
    expect(events.find((event) => event.type === "tool-call")).toMatchObject({
      toolCallId: "call_1",
      toolName: "lookup",
      input: { query: "weather" },
    })
  })

  test("maps native tool results and errors into processor events", () => {
    const events = LLMNativeEvents.toSessionEvents([
      { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
      { type: "tool-result", id: "call_1", name: "lookup", result: { type: "json", value: { forecast: "sunny" } } },
      { type: "tool-error", id: "call_2", name: "lookup", message: "bad input" },
      { type: "tool-result", id: "call_3", name: "lookup", result: { type: "error", value: "provider failed" } },
    ] satisfies ReadonlyArray<LLMEvent>)

    expect(events.find((event) => event.type === "tool-result")).toMatchObject({
      toolCallId: "call_1",
      output: { title: "", metadata: {}, output: '{"forecast":"sunny"}' },
    })
    expect(events.filter((event) => event.type === "tool-error")).toEqual([
      { type: "tool-error", toolCallId: "call_2", toolName: "lookup", input: {}, error: "bad input" },
      { type: "tool-error", toolCallId: "call_3", toolName: "lookup", input: {}, error: "provider failed" },
    ])
  })

  test("maps provider errors into fatal processor errors", () => {
    const events = LLMNativeEvents.toSessionEvents([{ type: "provider-error", message: "rate limited", retryable: true }])

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("error")
    if (events[0].type === "error") expect(events[0].error).toEqual(new Error("rate limited"))
  })
})
