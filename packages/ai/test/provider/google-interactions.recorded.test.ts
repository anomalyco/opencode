import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { LLM, LLMEvent, Message } from "../../src/index.js"
import { Google } from "../../src/providers.js"
import { LLMClient, RequestExecutor } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"
import { weatherTool } from "../recorded-scenarios.js"

const model = Google.configure({ apiKey: process.env.GEMINI_API_KEY ?? "fixture" }).interactions("gemini-3.8-flash")
const recorded = recordedTests({
  prefix: "google-interactions",
  provider: "google",
  protocol: "google-interactions",
  requires: ["GEMINI_API_KEY"],
})
const InteractionMetadata = Schema.Struct({ interactionId: Schema.String })

describe("Google Interactions recorded", () => {
  recorded.effect("streams text and reports usage", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model,
          prompt: "Reply with exactly one word: hello",
          generation: { maxTokens: 2048 },
          providerOptions: { thinkingLevel: "low" },
        }),
      )

      expect(response.text.trim().toLowerCase()).toBe("hello")
      expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
      expect(response.finishReason.normalized).toBe("stop")
      expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
      expect(response.usage?.inputTokens).toBeGreaterThan(0)
      expect(response.usage?.contextTokens).toBeGreaterThan(0)
      expect(response.usage?.providerMetadata?.google).toMatchObject({ total_input_tokens: expect.any(Number) })
    }),
  )

  recorded.effect(
    "streams reasoning and retains thought signatures",
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model,
            prompt:
              "Find the smallest positive integer that leaves remainder 1 modulo 7, 2 modulo 9, and 3 modulo 11. Explain briefly.",
            generation: { maxTokens: 4096 },
            providerOptions: { thinkingLevel: "high", thinkingSummaries: "auto" },
          }),
        )

        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
        expect(response.events.filter(LLMEvent.is.reasoningEnd)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              providerMetadata: { google: { interactionSignature: expect.any(String) } },
            }),
          ]),
        )
        expect(response.text.length).toBeGreaterThan(0)
        expect(response.finishReason.normalized).toBe("stop")
      }),
    120_000,
  )

  recorded.effect(
    "replays native tool results and signatures statelessly",
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model,
          system: "Use get_weather for weather questions. Answer concisely after receiving the result.",
          prompt: "What is the weather in Paris?",
          tools: [weatherTool],
          toolChoice: { type: "tool", name: weatherTool.name },
          generation: { maxTokens: 2048 },
          providerOptions: { thinkingLevel: "low", thinkingSummaries: "auto" },
        })
        const first = yield* LLMClient.generate(request)

        expect(first.toolCalls).toHaveLength(1)
        expect(first.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
        expect(first.finishReason.normalized).toBe("tool-calls")
        const call = first.toolCalls[0]
        if (!call) throw new Error("Missing recorded weather tool call")
        expect(call.name).toBe(weatherTool.name)
        expect(call.input).toEqual({ city: "Paris" })
        expect(call.providerMetadata?.google).toHaveProperty("interactionSignature")
        const second = yield* LLMClient.generate(
          LLM.request({
            model,
            system: request.system,
            tools: [weatherTool],
            toolChoice: "none",
            generation: { maxTokens: 2048 },
            providerOptions: { thinkingLevel: "low", thinkingSummaries: "auto" },
            messages: [
              ...request.messages,
              first.message,
              Message.tool({ id: call.id, name: call.name, result: { temperature: 22, condition: "sunny" } }),
            ],
          }),
        )

        expect(second.text.toLowerCase()).toContain("sunny")
        expect(second.text).toContain("22")
        expect(second.toolCalls).toHaveLength(0)
        expect(second.finishReason.normalized).toBe("stop")
      }),
    120_000,
  )

  recorded.effect(
    "continues tool results with previous interaction id",
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model,
          system: "Use get_weather for weather questions. Answer concisely after receiving the result.",
          prompt: "What is the weather in Paris?",
          tools: [weatherTool],
          toolChoice: "required",
          generation: { maxTokens: 2048 },
          providerOptions: { thinkingLevel: "low", store: true },
        })
        const first = yield* LLMClient.generate(request)
        const metadata = yield* Schema.decodeUnknownEffect(InteractionMetadata)(
          first.events.find(LLMEvent.is.finish)?.providerMetadata?.google,
        )
        const executor = yield* RequestExecutor.Service
        const cleanup = executor
          .execute(
            HttpClientRequest.delete(
              `https://generativelanguage.googleapis.com/v1beta/interactions/${metadata.interactionId}`,
            ).pipe(HttpClientRequest.setHeader("x-goog-api-key", process.env.GEMINI_API_KEY ?? "fixture")),
          )
          .pipe(Effect.orDie)

        yield* Effect.gen(function* () {
          expect(first.toolCalls).toHaveLength(1)
          const call = first.toolCalls[0]
          if (!call) throw new Error("Missing recorded weather tool call")
          const second = yield* LLMClient.generate(
            LLM.request({
              model,
              system: request.system,
              tools: [weatherTool],
              toolChoice: "none",
              generation: { maxTokens: 2048 },
              providerOptions: { thinkingLevel: "low", previousInteractionId: metadata.interactionId, store: false },
              messages: [
                Message.tool({ id: call.id, name: call.name, result: { temperature: 22, condition: "sunny" } }),
              ],
            }),
          )

          expect(second.text.toLowerCase()).toContain("sunny")
          expect(second.text).toContain("22")
          expect(second.toolCalls).toHaveLength(0)
          expect(second.finishReason.normalized).toBe("stop")
        }).pipe(Effect.ensuring(cleanup))
      }),
    120_000,
  )
})
