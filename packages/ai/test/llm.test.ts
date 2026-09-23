import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CacheHint, LLM, LLMResponse, ToolEntry, ToolNamespace } from "../src/index.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as OpenAIResponses from "../src/protocols/openai-responses.js"
import {
  GenerationOptions,
  LLMRequest,
  Message,
  LanguageModel,
  ToolCallPart,
  ToolChoice,
  ToolDefinition,
  ToolResultPart,
} from "../src/schema/index.js"

const chatRoute = OpenAIChat.route
const responsesRoute = OpenAIResponses.route

describe("llm constructors", () => {
  test("normalizes recursive tool namespaces", () => {
    const request = LLM.request({
      model: LanguageModel.make({ id: "fake-model", provider: "fake", route: responsesRoute }),
      tools: [
        {
          type: "namespace",
          name: "crm",
          description: "Customer management",
          tools: [
            { name: "lookup", description: "Look up a customer", inputSchema: { type: "object" } },
            {
              type: "namespace",
              name: "orders",
              tools: [{ name: "list", description: "List orders", inputSchema: { type: "object" } }],
            },
          ],
        },
      ],
    })

    expect(request.tools[0]).toEqual({
      type: "namespace",
      name: "crm",
      description: "Customer management",
      tools: [
        expect.objectContaining({ type: "tool", name: "lookup" }),
        {
          type: "namespace",
          name: "orders",
          description: undefined,
          tools: [expect.objectContaining({ type: "tool", name: "list" })],
        },
      ],
    })
    expect(request.tools[0]).toEqual(
      ToolNamespace.make({
        name: "crm",
        description: "Customer management",
        tools: request.tools[0]!.type === "namespace" ? request.tools[0].tools : [],
      }),
    )
    expect(Schema.decodeUnknownSync(ToolEntry)(Schema.encodeUnknownSync(ToolEntry)(request.tools[0]))).toEqual(
      request.tools[0],
    )
  })

  test("builds canonical schema classes from ergonomic input", () => {
    const request = LLM.request({
      id: "req_1",
      model: LanguageModel.make({ id: "fake-model", provider: "fake", route: chatRoute }),
      system: "You are concise.",
      prompt: "Say hello.",
    })

    expect(request).toBeInstanceOf(LLMRequest)
    expect(request.model).toBeInstanceOf(LanguageModel)
    expect(request.messages[0]).toBeInstanceOf(Message)
    expect(request.system).toEqual([{ type: "text", text: "You are concise." }])
    expect(request.messages[0]?.content).toEqual([{ type: "text", text: "Say hello." }])
    expect(request.generation).toBeUndefined()
    expect(request.tools).toEqual([])
  })

  test("updates requests without spreading schema class instances", () => {
    const base = LLM.request({
      id: "req_1",
      model: LanguageModel.make({ id: "fake-model", provider: "fake", route: chatRoute }),
      prompt: "Say hello.",
    })
    const updated = LLMRequest.update(base, {
      generation: GenerationOptions.make({ maxTokens: 20 }),
      messages: [...base.messages, Message.assistant("Hi.")],
    })

    expect(updated).toBeInstanceOf(LLMRequest)
    expect(updated.id).toBe("req_1")
    expect(updated.model).toEqual(base.model)
    expect(updated.generation).toEqual({ maxTokens: 20 })
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"])
  })

  test("keeps request options separate from route defaults", () => {
    const request = LLM.request({
      model: LanguageModel.make({
        id: "fake-model",
        provider: "fake",
        route: chatRoute.with({
          generation: { maxTokens: 100, temperature: 1 },
          providerOptions: { store: false, metadata: { model: true } },
          http: { body: { metadata: { model: true } }, headers: { "x-shared": "model" }, query: { model: "1" } },
        }),
      }),
      prompt: "Say hello.",
      generation: { temperature: 0 },
      providerOptions: { store: true, metadata: { request: true } },
      http: { body: { metadata: { request: true } }, headers: { "x-shared": "request" }, query: { request: "1" } },
    })

    expect(request.generation).toEqual({ temperature: 0 })
    expect(request.providerOptions).toEqual({ store: true, metadata: { request: true } })
    expect(request.http).toEqual({
      body: { metadata: { request: true } },
      headers: { "x-shared": "request" },
      query: { request: "1" },
    })
  })

  test("updates canonical requests from the request datatype", () => {
    const base = LLM.request({
      id: "req_1",
      model: LanguageModel.make({ id: "fake-model", provider: "fake", route: chatRoute }),
      prompt: "Say hello.",
    })
    const updated = LLMRequest.update(base, { messages: [...base.messages, Message.assistant("Hi.")] })

    expect(updated).toBeInstanceOf(LLMRequest)
    expect(updated.id).toBe("req_1")
    expect(LLMRequest.input(updated).id).toBe("req_1")
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(LLMRequest.update(updated, {})).toBe(updated)
  })

  test("updates canonical models from the model datatype", () => {
    const base = LanguageModel.make({
      id: "fake-model",
      provider: "fake",
      route: chatRoute,
    })
    const updated = LanguageModel.update(base, {
      route: responsesRoute,
      defaults: { generation: { maxTokens: 20 } },
      compatibility: { toolSchema: "gemini", requireFinishReason: false },
    })
    const updatedInput = LanguageModel.input(updated)

    expect(updated).toBeInstanceOf(LanguageModel)
    expect(String(updated.id)).toBe("fake-model")
    expect(updated.route).toBe(responsesRoute)
    expect(updated.defaults?.generation).toEqual({ maxTokens: 20 })
    expect(updated.compatibility).toEqual({ toolSchema: "gemini", requireFinishReason: false })
    expect(updatedInput.defaults).toBe(updated.defaults)
    expect(updatedInput.compatibility).toBe(updated.compatibility)
    expect(String(updatedInput.provider)).toBe("fake")
    expect(LanguageModel.update(updated, {})).toBe(updated)
  })

  test("carries model defaults and compatibility through route model selection", () => {
    const model = chatRoute.model({
      id: "kimi-k2",
      defaults: {
        generation: { maxTokens: 1_024, stop: ["END"] },
        providerOptions: { parallelToolCalls: false },
        http: { body: { extra_body: true } },
      },
      compatibility: { toolSchema: "moonshot" },
    })
    const request = LLM.request({ model, prompt: "Say hello." })

    expect(request.model.defaults?.generation).toEqual({ maxTokens: 1_024, stop: ["END"] })
    expect(request.model.defaults?.providerOptions).toEqual({ parallelToolCalls: false })
    expect(request.model.defaults?.http).toEqual({ body: { extra_body: true } })
    expect(request.model.compatibility).toEqual({ toolSchema: "moonshot" })
    expect(request.generation).toBeUndefined()
    expect(request.providerOptions).toBeUndefined()
    expect(request.http).toBeUndefined()
  })

  test("builds tool choices from names and tools", () => {
    const tool = ToolDefinition.make({ name: "lookup", description: "Lookup data", inputSchema: { type: "object" } })

    expect(tool).toBeInstanceOf(ToolDefinition)
    expect(ToolChoice.make("lookup")).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
    expect(ToolChoice.named("required")).toEqual(new ToolChoice({ type: "tool", name: "required" }))
    expect(ToolChoice.make(tool)).toEqual(new ToolChoice({ type: "tool", name: "lookup" }))
  })

  test("builds tool choice modes from reserved strings", () => {
    expect(ToolChoice.make("auto")).toEqual(new ToolChoice({ type: "auto" }))
    expect(ToolChoice.make("none")).toEqual(new ToolChoice({ type: "none" }))
    expect(ToolChoice.make("required")).toEqual(new ToolChoice({ type: "required" }))
    expect(
      LLM.request({
        model: LanguageModel.make({
          id: "fake-model",
          provider: "fake",
          route: chatRoute,
        }),
        prompt: "Use tools if needed.",
        toolChoice: "required",
      }).toolChoice,
    ).toEqual(new ToolChoice({ type: "required" }))
  })

  test("builds assistant tool calls and tool result messages", () => {
    const call = ToolCallPart.make({ id: "call_1", name: "lookup", input: { query: "weather" } })
    const result = ToolResultPart.make({ id: "call_1", name: "lookup", result: { temperature: 72 } })

    expect(Message.assistant([call]).content).toEqual([call])
    expect(Message.tool(result).content).toEqual([
      { type: "tool-result", id: "call_1", name: "lookup", result: { type: "json", value: { temperature: 72 } } },
    ])
  })

  test("builds chronological text-only system updates separately from the initial system prompt", () => {
    const update = Message.system([
      { type: "text", text: "Use parameterized SQL.", cache: new CacheHint({ type: "ephemeral" }) },
    ])
    const request = LLM.request({
      model: LanguageModel.make({ id: "fake-model", provider: "fake", route: chatRoute }),
      system: "Initial operator prompt.",
      messages: [Message.user("Review this."), update],
    })

    expect(update).toBeInstanceOf(Message)
    expect(update).toEqual({
      role: "system",
      content: [{ type: "text", text: "Use parameterized SQL.", cache: { type: "ephemeral" } }],
    })
    expect(request.system).toEqual([{ type: "text", text: "Initial operator prompt." }])
    expect(request.messages.map((message) => message.role)).toEqual(["user", "system"])
  })

  test("extracts output text from response events", () => {
    expect(
      LLMResponse.text({
        events: [
          { type: "text-delta", id: "text-0", text: "hi" },
          { type: "finish", reason: { normalized: "stop" } },
        ],
      }),
    ).toBe("hi")
  })
})
