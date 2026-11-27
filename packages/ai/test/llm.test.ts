import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, CacheHint, GENERATION_KEYS, LLMEvent, LLMResponse, ToolEntry, ToolNamespace } from "../src/effect.js"
import type { AnyApi } from "../src/api.js"
import { OpenAI } from "../src/providers.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import * as OpenAIResponses from "../src/protocols/openai-responses.js"
import { Auth } from "../src/route/auth.js"
import {
  Message,
  LanguageModel,
  SystemMessage,
  ToolCallPart,
  ToolChoice,
  ToolDefinition,
  ToolResultPart,
  UserMessage,
} from "../src/schema/index.js"
import { fixedResponse } from "./lib/http.js"
import { apiModel } from "./lib/model.js"
import { sseEvents } from "./lib/sse.js"

const fake = (api: AnyApi = OpenAIChat.api) =>
  LanguageModel.make({ id: "fake-model", provider: "fake", api, baseURL: "https://api.openai.com/v1", auth: Auth.none })

describe("llm constructors", () => {
  test("normalizes recursive tool namespaces", () => {
    const request = ai.request({
      model: fake(OpenAIResponses.api),
      prompt: "Hello",
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

  test("normalizes ergonomic input into a plain request", () => {
    const request = ai.request({
      id: "req_1",
      model: fake(),
      system: "You are concise.",
      prompt: "Say hello.",
    })

    expect(Object.getPrototypeOf(request)).toBe(Object.prototype)
    expect(request.model).toBeInstanceOf(LanguageModel)
    expect(request.messages[0]).toBeInstanceOf(UserMessage)
    expect(request.system).toEqual([{ type: "text", text: "You are concise." }])
    expect(request.messages[0]?.content).toEqual([{ type: "text", text: "Say hello." }])
    expect(request.maxTokens).toBeUndefined()
    expect(request.tools).toEqual([])
  })

  test("edits requests with a spread or by passing them back to ai.request", () => {
    const base = ai.request({
      id: "req_1",
      model: fake(),
      prompt: "Say hello.",
    })
    const updated = {
      ...base,
      maxTokens: 20,
      messages: [...base.messages, Message.assistant("Hi.")],
    }

    expect(updated.id).toBe("req_1")
    expect(updated.model).toBe(base.model)
    expect(updated.maxTokens).toBe(20)
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(ai.request(updated)).toEqual(updated)
    expect(ai.request(updated).messages[1]).toBe(updated.messages[1])

    const prompted = ai.request({
      ...updated,
      system: "Be brief.",
      messages: [...updated.messages, Message.user("Again.")],
    })
    expect(prompted.system).toEqual([{ type: "text", text: "Be brief." }])
    expect(prompted.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"])
  })

  test("lists the portable knobs", () => {
    expect([...GENERATION_KEYS]).toEqual([
      "maxTokens",
      "temperature",
      "topP",
      "topK",
      "frequencyPenalty",
      "presencePenalty",
      "seed",
      "stop",
    ])
  })

  test("keeps request options separate from model defaults", () => {
    const request = ai.request({
      model: LanguageModel.update(fake(), {
        options: {
          maxTokens: 100,
          temperature: 1,
          providerOptions: { store: false, metadata: { model: true } },
          http: { body: { metadata: { model: true } }, headers: { "x-shared": "model" }, query: { model: "1" } },
        },
      }),
      prompt: "Say hello.",
      temperature: 0,
      providerOptions: { store: true, metadata: { request: true } },
      headers: { "x-shared": "request" },
      http: { body: { metadata: { request: true } }, query: { request: "1" } },
    })

    expect(request.temperature).toBe(0)
    expect(request.maxTokens).toBeUndefined()
    expect(request.providerOptions).toEqual({ store: true, metadata: { request: true } })
    expect(request.headers).toEqual({ "x-shared": "request" })
    expect(request.http).toEqual({ body: { metadata: { request: true } }, query: { request: "1" } })
  })

  test("updates canonical models from the model datatype", () => {
    const base = fake()
    const updated = LanguageModel.update(base, {
      options: { maxTokens: 20 },
      capabilities: { tools: { sanitizer: "gemini" }, output: { requireFinishReason: false } },
    })

    expect(updated).toBeInstanceOf(LanguageModel)
    expect(String(updated.id)).toBe("fake-model")
    expect(String(updated.provider)).toBe("fake")
    expect(updated.api).toBe(base.api)
    expect(updated.options?.maxTokens).toBe(20)
    expect(updated.capabilities).toEqual({ tools: { sanitizer: "gemini" }, output: { requireFinishReason: false } })
    expect(LanguageModel.update(updated, {})).toBe(updated)
  })

  test("carries model defaults and capabilities through provider model selection", () => {
    const model = apiModel(OpenAIChat.api, "kimi-k2", {
      baseURL: "https://api.openai.com/v1",
      options: {
        maxTokens: 1_024,
        stop: ["END"],
        providerOptions: { parallelToolCalls: false },
        http: { body: { extra_body: true } },
      },
      capabilities: { tools: { sanitizer: "moonshot" } },
    })
    const request = ai.request({ model, prompt: "Say hello." })

    expect(request.model.options).toMatchObject({ maxTokens: 1_024, stop: ["END"] })
    expect(request.model.options?.providerOptions).toEqual({ parallelToolCalls: false })
    expect(request.model.options?.http).toEqual({ body: { extra_body: true } })
    expect(request.model.capabilities).toEqual({ tools: { sanitizer: "moonshot" } })
    expect(request.maxTokens).toBeUndefined()
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
      ai.request({
        model: fake(),
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
    const request = ai.request({
      model: fake(),
      system: "Initial operator prompt.",
      messages: [Message.user("Review this."), update],
    })

    expect(update).toBeInstanceOf(SystemMessage)
    expect(update).toEqual({
      role: "system",
      content: [{ type: "text", text: "Use parameterized SQL.", cache: { type: "ephemeral" } }],
    })
    expect(request.system).toEqual([{ type: "text", text: "Initial operator prompt." }])
    expect(request.messages.map((message) => message.role)).toEqual(["user", "system"])
  })

  test("generates and streams from input or a prebuilt request", async () => {
    const model = OpenAI.openai
      .with({ apiKey: "test", baseURL: "https://openai.test/v1" })
      .model("gpt-4o-mini", { api: "chat-completions" })
    const layer = fixedResponse(
      sseEvents({ choices: [{ delta: { content: "Hello" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }),
    )
    const input = { model, prompt: "Say hello." }
    const request = ai.request(input)
    const generated = await Effect.runPromise(ai.generate(input).pipe(Effect.provide(layer)))
    const generatedFromRequest = await Effect.runPromise(ai.generate(request).pipe(Effect.provide(layer)))
    expect(generated.text).toBe("Hello")
    expect(generatedFromRequest.text).toBe(generated.text)

    const streamed = await Effect.runPromise(ai.stream(input).pipe(Stream.runCollect, Effect.provide(layer)))
    const streamedFromRequest = await Effect.runPromise(
      ai.stream(request).pipe(Stream.runCollect, Effect.provide(layer)),
    )
    expect(Array.from(streamed).some(LLMEvent.is.textDelta)).toBe(true)
    expect(streamedFromRequest).toEqual(streamed)
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
