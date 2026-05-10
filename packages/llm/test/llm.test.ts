import { describe, expect, test } from "bun:test"
import { LLM, LLMResponse } from "../src"
import { LLMRequest, Message, ModelRef, ToolChoice, ToolDefinition } from "../src/schema"

describe("llm constructors", () => {
  test("builds canonical schema classes from ergonomic input", () => {
    const request = LLM.request({
      id: "req_1",
      model: LLM.model({ id: "fake-model", provider: "fake", route: "openai-chat", baseURL: "https://fake.local" }),
      system: "You are concise.",
      prompt: "Say hello.",
    })

    expect(request).toBeInstanceOf(LLMRequest)
    expect(request.model).toBeInstanceOf(ModelRef)
    expect(request.messages[0]).toBeInstanceOf(Message)
    expect(request.system).toEqual([{ type: "text", text: "You are concise." }])
    expect(request.messages[0]?.content).toEqual([{ type: "text", text: "Say hello." }])
    expect(request.generation).toBeUndefined()
    expect(request.tools).toEqual([])
  })

  test("updates requests without spreading schema class instances", () => {
    const base = LLM.request({
      id: "req_1",
      model: LLM.model({ id: "fake-model", provider: "fake", route: "openai-chat", baseURL: "https://fake.local" }),
      prompt: "Say hello.",
    })
    const updated = LLM.updateRequest(base, {
      generation: { maxTokens: 20 },
      messages: [...base.messages, LLM.assistant("Hi.")],
    })

    expect(updated).toBeInstanceOf(LLMRequest)
    expect(updated.id).toBe("req_1")
    expect(updated.model).toEqual(base.model)
    expect(updated.generation).toEqual({ maxTokens: 20 })
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  })

  test("keeps request options separate from model defaults", () => {
    const request = LLM.request({
      model: LLM.model({
        id: "fake-model",
        provider: "fake",
        route: "openai-chat",
        baseURL: "https://fake.local",
        generation: { maxTokens: 100, temperature: 1 },
        providerOptions: { openai: { store: false, metadata: { model: true } } },
        http: { body: { metadata: { model: true } }, headers: { "x-shared": "model" }, query: { model: "1" } },
      }),
      prompt: "Say hello.",
      generation: { temperature: 0 },
      providerOptions: { openai: { store: true, metadata: { request: true } } },
      http: { body: { metadata: { request: true } }, headers: { "x-shared": "request" }, query: { request: "1" } },
    })

    expect(request.generation).toEqual({ temperature: 0 })
    expect(request.providerOptions).toEqual({ openai: { store: true, metadata: { request: true } } })
    expect(request.http).toEqual({
      body: { metadata: { request: true } },
      headers: { "x-shared": "request" },
      query: { request: "1" },
    })
  })

  test("updates canonical requests from the request datatype", () => {
    const base = LLM.request({
      id: "req_1",
      model: LLM.model({ id: "fake-model", provider: "fake", route: "openai-chat", baseURL: "https://fake.local" }),
      prompt: "Say hello.",
    })
    const updated = LLMRequest.update(base, { messages: [...base.messages, LLM.assistant("Hi.")] })

    expect(updated).toBeInstanceOf(LLMRequest)
    expect(updated.id).toBe("req_1")
    expect(LLMRequest.input(updated).id).toBe("req_1")
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(LLMRequest.update(updated, {})).toBe(updated)
  })

  test("updates canonical models from the model datatype", () => {
    const base = LLM.model({ id: "fake-model", provider: "fake", route: "openai-chat", baseURL: "https://fake.local" })
    const updated = ModelRef.update(base, { route: "openai-responses" })

    expect(updated).toBeInstanceOf(ModelRef)
    expect(String(updated.id)).toBe("fake-model")
    expect(updated.route).toBe("openai-responses")
    expect(String(ModelRef.input(updated).provider)).toBe("fake")
    expect(ModelRef.update(updated, {})).toBe(updated)
  })

  test("builds tool choices from names and tools", () => {
    const tool = LLM.toolDefinition({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })

    expect(tool).toBeInstanceOf(ToolDefinition)
    expect(LLM.toolChoice("lookup")).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
    expect(LLM.toolChoiceName("required")).toEqual(new ToolChoice({ type: "tool", name: "required" }))
    expect(LLM.toolChoice(tool)).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
  })

  test("builds tool choice modes from reserved strings", () => {
    expect(LLM.toolChoice("auto")).toEqual(new ToolChoice({ type: "auto" }))
    expect(LLM.toolChoice("none")).toEqual(new ToolChoice({ type: "none" }))
    expect(LLM.toolChoice("required")).toEqual(new ToolChoice({ type: "required" }))
    expect(
      LLM.request({
        model: LLM.model({ id: "fake-model", provider: "fake", route: "openai-chat", baseURL: "https://fake.local" }),
        prompt: "Use tools if needed.",
        toolChoice: "required",
      }).toolChoice,
    ).toEqual(new ToolChoice({ type: "required" }))
  })

  test("builds assistant tool calls and tool result messages", () => {
    const call = LLM.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } })
    const result = LLM.toolResult({ id: "call_1", name: "lookup", result: { temperature: 72 } })

    expect(LLM.assistant([call]).content).toEqual([call])
    expect(LLM.toolMessage(result).content).toEqual([
      { type: "tool-result", id: "call_1", name: "lookup", result: { type: "json", value: { temperature: 72 } } },
    ])
  })

  test("extracts output text from response events", () => {
    expect(
      LLMResponse.text({
        events: [
          { type: "text-delta", text: "hi" },
          { type: "request-finish", reason: "stop" },
        ],
      }),
    ).toBe("hi")
  })
})
