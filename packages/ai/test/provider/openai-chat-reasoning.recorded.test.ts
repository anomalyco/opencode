import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMResponse } from "../../src"
import { OpenAIChat } from "../../src/protocols/openai-chat"
import * as OpenAICompatible from "../../src/providers/openai-compatible"
import * as OpenRouter from "../../src/providers/openrouter"
import { LLMClient } from "../../src/route"
import { recordedTests } from "../recorded-test"
import { expectWeatherToolLoop, goldenWeatherToolLoopRequest, runWeatherToolLoop } from "../recorded-scenarios"

const cases = [
  {
    name: "OpenRouter",
    model: OpenRouter.configure({
      apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
      providerOptions: { openrouter: { reasoning: { max_tokens: 1024 } } },
    }).model("anthropic/claude-sonnet-4.6"),
    requires: ["OPENROUTER_API_KEY"],
    cassette: "openrouter-reasoning",
    structured: true,
  },
  {
    name: "Vercel AI Gateway",
    model: OpenAICompatible.configure({
      provider: "vercel-ai-gateway",
      baseURL: "https://ai-gateway.vercel.sh/v1",
      apiKey: process.env.AI_GATEWAY_API_KEY ?? "fixture",
      http: { body: { reasoning: { enabled: true, max_tokens: 1024 } } },
    }).model("anthropic/claude-sonnet-4.6"),
    requires: ["AI_GATEWAY_API_KEY"],
    cassette: "vercel-ai-gateway-reasoning",
    structured: true,
  },
] as const

for (const item of cases) {
  const recorded = recordedTests({
    prefix: "openai-compatible-chat",
    provider: item.model.provider,
    protocol: "openai-chat",
    requires: item.requires,
    tags: ["reasoning"],
    metadata: { model: item.model.id },
  })

  describe(`${item.name} reasoning recorded`, () => {
    recorded.effect.with(
      "streams scalar reasoning",
      { cassette: item.cassette },
      () =>
        Effect.gen(function* () {
          const response = yield* LLMClient.generate(
            LLM.request({
              model: item.model,
              system: "Think through the arithmetic, then reply with only the final integer.",
              prompt: "What is 173 multiplied by 219?",
              generation: { maxTokens: 1536, temperature: 0 },
            }),
          )

          expect(response.text.replaceAll(",", "").trim()).toBe("37887")
          expect(response.reasoning.length).toBeGreaterThan(0)
          expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
          const metadata = response.message.content.find((part) => part.type === "reasoning")?.providerMetadata
          expect(metadata?.openai?.reasoningField).toBe(item.structured ? "reasoning" : "reasoning_content")
          expect(Array.isArray(metadata?.openai?.reasoningDetails)).toBe(item.structured)
          if (!item.structured) return
          const details = metadata?.openai?.reasoningDetails
          if (!Array.isArray(details)) return
          expect(
            details.some(
              (detail) =>
                typeof detail === "object" &&
                detail !== null &&
                "signature" in detail &&
                typeof detail.signature === "string" &&
                detail.signature.length > 0,
            ),
          ).toBe(true)

          const replay = yield* LLMClient.prepare<OpenAIChat.OpenAIChatBody>(
            LLM.request({ model: item.model, messages: [response.message] }),
          )
          expect(replay.body.messages).toMatchObject([
            { role: "assistant", content: response.text, reasoning: response.reasoning },
          ])
          const replayDetails =
            replay.body.messages[0]?.role === "assistant" ? replay.body.messages[0].reasoning_details : undefined
          expect(Array.isArray(replayDetails)).toBe(true)
          if (!Array.isArray(replayDetails)) return
          expect(replayDetails).toEqual(details)
          expect(replayDetails).toHaveLength(1)
          expect(replayDetails[0]).toMatchObject({
            type: "reasoning.text",
            text: response.reasoning,
            signature: expect.any(String),
          })
        }),
      30_000,
    )

    recorded.effect.with(
      "continues signed reasoning through a tool loop",
      { cassette: `${item.cassette}-tool-loop`, tags: ["continuation", "tool", "tool-loop"] },
      () =>
        Effect.gen(function* () {
          const events = yield* runWeatherToolLoop(
            goldenWeatherToolLoopRequest({
              id: `${item.cassette}-tool-loop`,
              model: item.model,
              maxTokens: 1536,
              temperature: false,
            }),
          )

          expectWeatherToolLoop(events)
          expect(
            LLMResponse.text({
              events: events.slice(events.findIndex(LLMEvent.is.stepFinish) + 1),
            }).trim(),
          ).toMatch(/^Paris is sunny\.?$/)
          const details = events
            .filter(LLMEvent.is.reasoningEnd)
            .map((event) => event.providerMetadata?.openai?.reasoningDetails)
            .find(Array.isArray)
          expect(Array.isArray(details)).toBe(item.structured)
          if (!item.structured || !Array.isArray(details)) return
          expect(
            details.some(
              (detail) =>
                typeof detail === "object" &&
                detail !== null &&
                "signature" in detail &&
                typeof detail.signature === "string" &&
                detail.signature.length > 0,
            ),
          ).toBe(true)
        }),
      60_000,
    )
  })
}
