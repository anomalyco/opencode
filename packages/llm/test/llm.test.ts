import { describe, expect, test } from "bun:test"
import { LLM } from "../src"
import { LLMRequest, Message, ModelRef, ToolChoice, ToolDefinition } from "../src/schema"

describe("llm constructors", () => {
  test("builds canonical schema classes from ergonomic input", () => {
    const request = LLM.request({
      id: "req_1",
      model: LLM.model({ id: "fake-model", provider: "fake", protocol: "openai-chat" }),
      system: "You are concise.",
      prompt: "Say hello.",
    })

    expect(request).toBeInstanceOf(LLMRequest)
    expect(request.model).toBeInstanceOf(ModelRef)
    expect(request.messages[0]).toBeInstanceOf(Message)
    expect(request.system).toEqual([{ type: "text", text: "You are concise." }])
    expect(request.messages[0]?.content).toEqual([{ type: "text", text: "Say hello." }])
    expect(request.generation).toEqual({})
    expect(request.tools).toEqual([])
  })

  test("builds tool choices from names and tools", () => {
    const tool = LLM.tool({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })

    expect(tool).toBeInstanceOf(ToolDefinition)
    expect(LLM.toolChoice("lookup")).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
    expect(LLM.toolChoice(tool)).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
  })

  test("builds assistant tool calls and tool result messages", () => {
    const call = LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })
    const result = LLM.toolResult({ id: "call_1", name: "lookup", result: { temperature: 72 } })

    expect(LLM.assistant([call]).content).toEqual([call])
    expect(LLM.toolMessage(result).content).toEqual([
      { type: "tool-result", id: "call_1", name: "lookup", result: { type: "json", value: { temperature: 72 } } },
    ])
  })

  test("extracts output text from responses", () => {
    expect(LLM.outputText({ events: [{ type: "text-delta", text: "hi" }, { type: "request-finish", reason: "stop" }] })).toBe("hi")
  })
})
