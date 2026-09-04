import { configure } from "@opencode-ai/ai/providers/groq"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, LLMResponse, Message, ToolChoice, ToolDefinition } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.GROQ_API_KEY ?? "fixture"
const recorded = recordedTests({
  prefix: "groq-chat",
  provider: "groq",
  protocol: "groq-chat",
  requires: ["GROQ_API_KEY"],
})

const weather = ToolDefinition.make({
  name: "lookup_weather",
  description: "Look up the current weather for a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris", "London"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

describe("Groq recorded", () => {
  recorded.effect.with(
    "streams text with usage",
    { tags: ["text", "usage"], metadata: { model: "openai/gpt-oss-20b" } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: configure({
            apiKey,
            providerOptions: {
              includeReasoning: false,
              reasoningEffort: "low",
              serviceTier: "on_demand",
              user: "recorded-test",
            },
          }).model("openai/gpt-oss-20b"),
          prompt: "Reply with exactly one word: hello",
          generation: { maxTokens: 512 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body).toMatchObject({
          max_completion_tokens: 512,
          stream_options: { include_usage: true },
          include_reasoning: false,
          service_tier: "on_demand",
          user: "recorded-test",
        })
        expect(compiled.body.max_tokens).toBeUndefined()
        expect(compiled.body.store).toBeUndefined()
        expect(compiled.body.reasoning_format).toBeUndefined()

        const response = yield* LLMClient.generate(request)
        expect(response.text.toLowerCase().trim()).toBe("hello")
        expect(response.reasoning).toBe("")
        expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
        expectUsage(response)
      }),
    60_000,
  )

  for (const item of [
    {
      name: "continues Qwen parallel tool calls",
      model: configure({ apiKey, providerOptions: { parallelToolCalls: true, reasoningEffort: "none" } }).model(
        "qwen/qwen3.6-27b",
      ),
      cities: ["Paris", "London"],
      reasoning: false,
    },
    {
      name: "replays GPT OSS reasoning through a tool loop",
      model: configure({ apiKey, providerOptions: { includeReasoning: true, reasoningEffort: "low" } }).model(
        "openai/gpt-oss-20b",
      ),
      cities: ["Paris"],
      reasoning: true,
    },
  ]) {
    recorded.effect.with(
      item.name,
      {
        tags: ["tool", "tool-loop", "usage", item.reasoning ? "reasoning" : "parallel"],
        metadata: { model: item.model.id },
      },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: item.model,
            prompt: `Look up the current weather in ${item.cities.join(" and ")}. Call lookup_weather once for each city in the same response before answering. After receiving all results, report each city's weather in one short sentence.`,
            tools: [weather],
            toolChoice: "required",
            generation: { maxTokens: 1536 },
          })
          const compiled = yield* compileRequest(request)
          expect(compiled.body.stream_options).toEqual({ include_usage: true })
          expect(compiled.body.store).toBeUndefined()
          expect(compiled.body.reasoning_format).toBe(item.reasoning ? undefined : "parsed")
          expect(compiled.body.tools[0].function.strict).toBeUndefined()
          if (!item.reasoning) expect(compiled.body.parallel_tool_calls).toBe(true)

          const first = yield* LLMClient.generate(request)
          expect(first.finishReason.normalized).toBe("tool-calls")
          expect(first.toolCalls).toHaveLength(item.cities.length)
          expect(new Set(first.toolCalls.map((call) => call.id)).size).toBe(item.cities.length)
          expect(first.toolCalls.map((call) => call.input)).toEqual(
            expect.arrayContaining(item.cities.map((city) => ({ city }))),
          )
          expect(first.toolCalls.every((call) => call.name === "lookup_weather")).toBe(true)
          expectUsage(first)
          if (item.reasoning) {
            expect(first.reasoning.length).toBeGreaterThan(0)
            expect(first.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
          }

          const followUp = LLMRequest.update(request, {
            toolChoice: ToolChoice.make("none"),
            messages: [
              ...request.messages,
              first.message,
              ...first.toolCalls.map((call) =>
                Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
              ),
            ],
          })
          const replay = yield* compileRequest(followUp)
          if (item.reasoning) {
            expect(replay.body.messages).toEqual(
              expect.arrayContaining([expect.objectContaining({ role: "assistant", reasoning: first.reasoning })]),
            )
          }
          expect(replay.body.reasoning_format).toBe(item.reasoning ? undefined : "parsed")

          const second = yield* LLMClient.generate(followUp)
          expect(second.finishReason.normalized).toBe("stop")
          expect(second.toolCalls).toHaveLength(0)
          expect(second.text.toLowerCase()).toContain("sunny")
          item.cities.forEach((city) => expect(second.text).toContain(city))
          expectUsage(second)
        }),
      60_000,
    )
  }

  recorded.effect.with(
    "streams Qwen parsed reasoning",
    { tags: ["reasoning", "usage"], metadata: { model: "qwen/qwen3.6-27b" } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: configure({
            apiKey,
            providerOptions: { reasoningEffort: "default" },
          }).model("qwen/qwen3.6-27b"),
          prompt:
            "What is 173 multiplied by 219? Think through the arithmetic, then reply with only the final integer.",
          generation: { maxTokens: 2048 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body).toMatchObject({ reasoning_format: "parsed", reasoning_effort: "default" })
        expect(compiled.body.include_reasoning).toBeUndefined()

        const response = yield* LLMClient.generate(request)
        expect(response.text.replaceAll(",", "").trim()).toBe("37887")
        expect(response.text).not.toContain("<think>")
        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
        expectUsage(response)
      }),
    60_000,
  )
})

function expectUsage(response: LLMResponse) {
  expect(response.usage).toBeDefined()
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
}
