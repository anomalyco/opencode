import { expect } from "bun:test"
import { Effect } from "effect"
import { LanguageModel, LLM, Message } from "../../src/index.js"
import { OpenAIChat } from "../../src/protocols/openai-chat.js"
import { Groq } from "../../src/providers/groq.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { weatherTool } from "../recorded-scenarios.js"

it.effect("Groq reuses Chat streaming and omits optional provider controls by default", () =>
  Effect.gen(function* () {
    expect(Groq.protocol.stream).toBe(OpenAIChat.protocol.stream)
    const model = Groq.configure({ apiKey: "fixture" }).model("llama-3.3-70b-versatile")
    expect(model.route.endpoint.baseURL).toBe("https://api.groq.com/openai/v1")
    const compiled = yield* compileRequest(
      LLM.request({ model, prompt: "Hello", tools: [weatherTool], generation: { maxTokens: 64 } }),
    )
    expect(compiled.body).toMatchObject({ max_completion_tokens: 64, stream_options: { include_usage: true } })
    for (const key of [
      "store",
      "max_tokens",
      "reasoning_format",
      "include_reasoning",
      "parallel_tool_calls",
      "service_tier",
      "user",
    ])
      expect(compiled.body[key]).toBeUndefined()
    expect(compiled.body.tools?.[0]?.function).not.toHaveProperty("strict")
  }),
)

it.effect("Groq lowers its own options for custom catalog identities and endpoints", () =>
  Effect.gen(function* () {
    const model = LanguageModel.update(
      Groq.model("qwen/qwen3.6-27b", {
        apiKey: "fixture",
        baseURL: "https://gateway.example/v1",
        headers: { "x-client": "test" },
        body: { custom: "value" },
        providerOptions: {
          reasoningEffort: "default",
          reasoningFormat: "parsed",
          parallelToolCalls: true,
          serviceTier: "flex",
          user: "test-user",
        },
      }),
      { provider: "custom-groq" },
    )
    const compiled = yield* compileRequest(
      LLM.request({ model, prompt: "Hello", providerOptions: { parallelToolCalls: false } }),
    )
    expect(model.route.endpoint.baseURL).toBe("https://gateway.example/v1")
    expect(model.route.defaults.headers).toEqual({ "x-client": "test" })
    expect(model.route.defaults.http?.body).toEqual({ custom: "value" })
    expect(compiled.body).toMatchObject({
      reasoning_effort: "default",
      reasoning_format: "parsed",
      parallel_tool_calls: false,
      service_tier: "flex",
      user: "test-user",
    })
    expect(compiled.body.include_reasoning).toBeUndefined()
    for (const key of ["reasoningFormat", "reasoningEffort", "parallelToolCalls", "serviceTier"])
      expect(compiled.body).not.toHaveProperty(key)
  }),
)

it.effect("Groq replays reasoning only when present and preserves explicit reasoning exclusion", () =>
  Effect.gen(function* () {
    const compiled = yield* compileRequest(
      LLM.request({
        model: Groq.configure({ apiKey: "fixture" }).model("openai/gpt-oss-20b"),
        messages: [
          Message.user("Think"),
          Message.assistant([
            { type: "reasoning", text: "Thinking" },
            { type: "text", text: "Answer" },
          ]),
          Message.user("Again"),
          Message.assistant("Answer only"),
          Message.user("Continue"),
        ],
        providerOptions: { reasoningEffort: "low", includeReasoning: false },
      }),
    )
    expect(compiled.body).toMatchObject({ reasoning_effort: "low", include_reasoning: false })
    expect(compiled.body.reasoning_format).toBeUndefined()
    expect(compiled.body.messages[1]).toMatchObject({ reasoning: "Thinking", content: "Answer" })
    expect(compiled.body.messages[1]).not.toHaveProperty("reasoning_content")
    expect(compiled.body.messages[3]).not.toHaveProperty("reasoning")
  }),
)

it.effect("Groq validates option types and rejects conflicting reasoning controls", () =>
  Effect.gen(function* () {
    for (const providerOptions of [
      { reasoningFormat: "parsed", includeReasoning: false },
      { parallelToolCalls: "false" },
    ]) {
      const error = yield* compileRequest(
        LLM.request({ model: Groq.configure({ apiKey: "fixture" }).model("qwen"), prompt: "Hello", providerOptions }),
      ).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
    }
  }),
)
