import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, type LanguageModel, LLMEvent, LLMResponse, ToolChoice, ToolDefinition } from "../../src/effect.js"
import { OpenCode } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const zen = OpenCode.configure({ apiKey: process.env.OPENCODE_API_KEY ?? "fixture" })
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

const cases: ReadonlyArray<{ api: string; protocol: string; model: LanguageModel }> = [
  {
    api: "chat",
    protocol: "openai-chat",
    model: zen.model("glm-5.3-flash"),
  },
  {
    api: "responses",
    protocol: "openai-responses",
    model: zen.responses("gpt-5-nano"),
  },
  {
    api: "messages",
    protocol: "anthropic-messages",
    model: zen.messages("claude-haiku-5-5"),
  },
  {
    api: "gemini",
    protocol: "gemini",
    model: zen.gemini("gemini-3.5-flash-lite"),
  },
]

describe("OpenCode Zen recorded", () => {
  for (const item of cases) {
    const recorded = recordedTests({
      prefix: `opencode-${item.api}`,
      provider: "opencode",
      protocol: item.protocol,
      requires: ["OPENCODE_API_KEY"],
      metadata: { model: item.model.id },
    })

    recorded.effect.with("streams text", { tags: ["text", "usage"] }, () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          ai.request({
            model: item.model,
            prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
            generation: { maxTokens: 2048 },
          }),
        )
        expect(response.text.replaceAll(",", "").trim()).toBe("37887")
        expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
        expectUsage(response)
      }),
    )

    recorded.effect.with("calls a tool", { tags: ["tool", "usage"] }, () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          ai.request({
            model: item.model,
            prompt: "Use get_weather to look up the current weather in Paris.",
            tools: [weather],
            toolChoice: ToolChoice.named("get_weather"),
            generation: { maxTokens: 2048 },
          }),
        )
        expect(response.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
        expectUsage(response)
      }),
    )
  }
})

function expectUsage(response: LLMResponse) {
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
}
