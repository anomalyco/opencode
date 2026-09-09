import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolDefinition, type LLMResponse } from "../../src/index.js"
import { ZAI } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.ZAI_API_KEY ?? "fixture"
const recorded = recordedTests({ prefix: "zai-chat", provider: "zai", protocol: "zai-chat", requires: ["ZAI_API_KEY"] })
const weather = ToolDefinition.make({
  name: "get_weather",
  description: "Get the current weather in a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

for (const effort of [undefined, "low", "high", "max"] as const) {
  recorded.effect.with(
    `GLM 5.3 streams ${effort ?? "default"} effort`,
    { tags: ["text", "reasoning", "usage"] },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: ZAI.configure({ apiKey, providerOptions: { reasoningEffort: effort } }).model("glm-5.3"),
          prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
          generation: { maxTokens: 4096 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body.thinking).toBeUndefined()
        expect(compiled.body.reasoning_effort).toBe(effort)
        const response = yield* LLMClient.generate(request)
        expect(response.text.replaceAll(",", "")).toContain("37887")
        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.finishReason.normalized).toBe("stop")
        expectUsage(response)
      }),
    120_000,
  )
}

recorded.effect.with(
  "GLM 5.3 preserves reasoning through a tool loop and follow-up",
  { tags: ["tool", "tool-loop", "reasoning", "continuation"] },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: ZAI.configure({
          apiKey,
          providerOptions: { reasoningEffort: "high", thinking: { type: "enabled", clear_thinking: false } },
        }).chat("glm-5.3"),
        prompt:
          "We have a budget of 38000 dollars for 219 trips costing 173 dollars each. Calculate whether that is affordable. If it is, use get_weather to look up the current weather in Paris. After receiving the result, report the weather in one short sentence.",
        tools: [weather],
        generation: { maxTokens: 4096 },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
      expect(first.finishReason.normalized).toBe("tool-calls")
      expect(first.reasoning.length).toBeGreaterThan(0)
      expect(first.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
      expectUsage(first)
      const continuation = LLMRequest.update(request, {
        messages: [
          ...request.messages,
          first.message,
          ...first.toolCalls.map((call) =>
            Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
          ),
        ],
      })
      const compiled = yield* compileRequest(continuation)
      expect(compiled.body.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "assistant", reasoning_content: first.reasoning })]),
      )
      const second = yield* LLMClient.generate(continuation)
      expect(second.text.toLowerCase()).toContain("sunny")
      expect(second.toolCalls).toHaveLength(0)
      expect(second.finishReason.normalized).toBe("stop")
      expectUsage(second)
      const followUp = LLMRequest.update(continuation, {
        messages: [
          ...continuation.messages,
          second.message,
          Message.user("What temperature did the tool report? Reply with only the temperature."),
        ],
      })
      const replay = yield* compileRequest(followUp)
      expect(replay.body.messages).toEqual(
        expect.arrayContaining(
          [first, second].map((response) =>
            expect.objectContaining({ role: "assistant", reasoning_content: response.reasoning }),
          ),
        ),
      )
      const third = yield* LLMClient.generate(followUp)
      expect(third.text).toContain("18")
      expect(third.toolCalls).toHaveLength(0)
      expect(third.finishReason.normalized).toBe("stop")
      expectUsage(third)
    }),
  180_000,
)

function expectUsage(response: LLMResponse) {
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
}
