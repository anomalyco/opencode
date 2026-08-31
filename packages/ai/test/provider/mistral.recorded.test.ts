import { configure } from "@opencode-ai/ai/providers/mistral"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolChoice, ToolDefinition } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.MISTRAL_API_KEY ?? "fixture"
const recorded = recordedTests({
  prefix: "mistral-chat",
  provider: "mistral",
  protocol: "mistral-chat",
  requires: ["MISTRAL_API_KEY"],
})
const glmRecorded = recordedTests({
  prefix: "mistral-chat-glm",
  provider: "mistral",
  protocol: "mistral-chat",
  requires: ["MISTRAL_API_KEY"],
})

const weather = ToolDefinition.make({
  name: "lookup_weather",
  description: "Look up the current weather for a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

describe("Mistral recorded", () => {
  recorded.effect.with(
    "streams text with usage",
    { tags: ["text", "usage"], metadata: { model: "mistral-small-latest" } },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: configure({ apiKey, providerOptions: { reasoningEffort: "none" } }).model("mistral-small-latest"),
            prompt: "Reply with exactly one word: hello",
            generation: { maxTokens: 40, temperature: 0 },
          }),
        )

        expect(response.text.trim()).toMatch(/^(?:hello|hi)[!.]?$/i)
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.usage?.inputTokens).toBeGreaterThan(0)
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
      }),
    60_000,
  )

  recorded.effect.with(
    "replays native reasoning",
    { tags: ["reasoning", "replay", "usage"], metadata: { model: "mistral-small-latest" } },
    () =>
      Effect.gen(function* () {
        const model = configure({ apiKey, providerOptions: { reasoningEffort: "high" } }).model("mistral-small-latest")
        const firstRequest = LLM.request({
          model,
          prompt: "Calculate 17 multiplied by 23. Think briefly, then reply with only the integer.",
          generation: { maxTokens: 512, temperature: 0 },
        })
        const first = yield* LLMClient.generate(firstRequest)

        expect(first.text.trim()).toBe("391")
        expect(first.reasoning.length).toBeGreaterThan(0)
        expect(first.events.some(LLMEvent.is.reasoningDelta)).toBe(true)

        const followUp = LLMRequest.update(firstRequest, {
          messages: [...firstRequest.messages, first.message, Message.user("Reply with exactly: Done.")],
          generation: { maxTokens: 256, temperature: 0 },
        })
        const replay = yield* compileRequest(followUp)
        expect(replay.body.messages).toContainEqual(
          expect.objectContaining({
            role: "assistant",
            content: expect.arrayContaining([expect.objectContaining({ type: "thinking" })]),
          }),
        )

        const second = yield* LLMClient.generate(followUp)
        expect(second.text.trim()).toMatch(/Done\.?$/)
        expect(second.finishReason.normalized).toBe("stop")
      }),
    60_000,
  )

  recorded.effect.with(
    "drives a tool loop",
    { tags: ["tool", "tool-loop", "usage"], metadata: { model: "mistral-small-latest" } },
    () =>
      Effect.gen(function* () {
        const model = configure({ apiKey, providerOptions: { reasoningEffort: "none" } }).model("mistral-small-latest")
        const firstRequest = LLM.request({
          model,
          system: "Call lookup_weather exactly once with Paris.",
          prompt: "What is the weather?",
          tools: [weather],
          toolChoice: weather,
          generation: { maxTokens: 160, temperature: 0 },
        })
        const first = yield* LLMClient.generate(firstRequest)

        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.toolCalls).toMatchObject([{ name: "lookup_weather", input: { city: "Paris" } }])
        expect(first.events.filter(LLMEvent.is.toolCall)).toHaveLength(1)

        const call = first.toolCalls[0]
        if (!call) throw new Error("Mistral did not return a tool call")
        const followUp = LLMRequest.update(firstRequest, {
          toolChoice: ToolChoice.make("none"),
          messages: [
            ...firstRequest.messages,
            first.message,
            Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
          ],
          generation: { maxTokens: 160, temperature: 0 },
        })
        const second = yield* LLMClient.generate(followUp)

        expect(second.finishReason.normalized).toBe("stop")
        expect(second.toolCalls).toHaveLength(0)
        expect(second.text.toLowerCase()).toContain("sunny")
      }),
    60_000,
  )
})

describe("Mistral hosted GLM recorded", () => {
  glmRecorded.effect.with(
    "streams an indexed tool call",
    { tags: ["hosted-model", "tool", "tool-call"], metadata: { model: "zai-glm-5-2" } },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: configure({ apiKey }).model("zai-glm-5-2"),
            system: "Call lookup_weather exactly once with Paris.",
            prompt: "What is the weather?",
            tools: [weather],
            toolChoice: weather,
            generation: { maxTokens: 256, temperature: 0 },
          }),
        )

        expect(response.finishReason.normalized).toBe("tool-calls")
        expect(response.toolCalls).toMatchObject([{ name: "lookup_weather", input: { city: "Paris" } }])
        expect(response.events.filter(LLMEvent.is.toolInputStart)).toHaveLength(1)
        expect(response.events.filter(LLMEvent.is.toolInputDelta).length).toBeGreaterThan(0)
        expect(response.events.filter(LLMEvent.is.toolInputEnd)).toHaveLength(1)
        expect(response.events.filter(LLMEvent.is.toolCall)).toHaveLength(1)
      }),
    60_000,
  )
})
