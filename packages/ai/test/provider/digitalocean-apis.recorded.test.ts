import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message, ToolNamespace } from "../../src/index.js"
import { DigitalOcean } from "../../src/providers/digitalocean.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import {
  LARGE_CACHEABLE_SYSTEM,
  expectWeatherToolLoop,
  goldenWeatherToolLoopRequest,
  runWeatherToolLoop,
} from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const provider = DigitalOcean.configure({ apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture" })

for (const item of [
  { id: "anthropic-claude-haiku-4.5", api: "messages", maxTokens: 128 },
  { id: "openai-gpt-5-nano", api: "responses", maxTokens: 1024 },
] as const) {
  const recorded = recordedTests({
    prefix: `digitalocean-${item.api}`,
    provider: "digitalocean",
    protocol: item.api,
    requires: ["DIGITAL_OCEAN_OFFICIAL_API_KEY"],
    metadata: { model: item.id },
  })
  describe(`DigitalOcean default ${item.api}`, () => {
    recorded.effect.with(
      "reuses cached input with inclusive usage",
      { tags: ["cache", "usage"] },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: provider.model(item.id),
            system: LARGE_CACHEABLE_SYSTEM,
            prompt: "Reply exactly: OK",
            generation: { maxTokens: item.maxTokens },
          })
          const first = yield* LLMClient.generate(request)
          const second = yield* LLMClient.generate(request)
          expect(second.usage.cacheReadInputTokens).toBeGreaterThan(0)
          for (const response of [first, second]) {
            expect(response.text.trim()).toMatch(/^OK\.?$/)
            expect(response.usage.inputTokens).toBeGreaterThan(4096)
            expect(response.usage.inputTokens).toBe(
              (response.usage.nonCachedInputTokens ?? 0) +
                (response.usage.cacheReadInputTokens ?? 0) +
                (response.usage.cacheWriteInputTokens ?? 0),
            )
          }
        }),
      60_000,
    )
    recorded.effect.with(
      "continues an automatic tool call",
      { tags: ["tool", "tool-loop"] },
      () =>
        Effect.gen(function* () {
          const request = goldenWeatherToolLoopRequest({
            id: `digitalocean-${item.api}-tool-loop`,
            model: provider.model(item.id),
            maxTokens: item.maxTokens,
            temperature: false,
          })
          expectWeatherToolLoop(yield* runWeatherToolLoop(LLMRequest.update(request, { cache: "auto" })))
        }),
      60_000,
    )
  })
}

const responses = recordedTests({
  prefix: "digitalocean-responses",
  provider: "digitalocean",
  protocol: "responses",
  requires: ["DIGITAL_OCEAN_OFFICIAL_API_KEY"],
})

responses.effect.with(
  "preserves a namespace across an automatic tool continuation",
  { tags: ["tool", "namespace"], metadata: { model: "openai-gpt-5.4-nano" } },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: provider.model("openai-gpt-5.4-nano"),
        prompt: "Call weather.lookup for Paris. After the tool result, reply exactly: Paris is sunny.",
        tools: [
          ToolNamespace.make({
            name: "weather",
            description: "Weather tools",
            tools: [
              {
                name: "lookup",
                description: "Get weather for a city",
                inputSchema: {
                  type: "object",
                  properties: { city: { type: "string" } },
                  required: ["city"],
                  additionalProperties: false,
                },
              },
            ],
          }),
        ],
        generation: { maxTokens: 512 },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.toolCalls).toMatchObject([{ name: "lookup", namespace: "weather", input: { city: "Paris" } }])
      const call = first.toolCalls[0]
      if (!call) throw new Error("Expected namespaced tool call")
      const second = yield* LLMClient.generate(
        LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            Message.tool({ id: call.id, name: call.name, namespace: call.namespace, result: { condition: "sunny" } }),
          ],
        }),
      )
      expect(second.text.trim()).toBe("Paris is sunny.")
    }),
  60_000,
)

responses.effect.with(
  "uses Responses for a non-OpenAI model",
  { tags: ["tool", "tool-loop"], metadata: { model: "kimi-k2.6" } },
  () =>
    Effect.gen(function* () {
      const request = goldenWeatherToolLoopRequest({
        id: "digitalocean-kimi-responses",
        model: provider.model("kimi-k2.6"),
        maxTokens: 1024,
        temperature: false,
      })
      expectWeatherToolLoop(yield* runWeatherToolLoop(request))
    }),
  60_000,
)

responses.effect.with(
  "accepts a native chronological effort update",
  { tags: ["effort", "reasoning"], metadata: { model: "openai-gpt-6-1-sol" } },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: DigitalOcean.configure({
          apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture",
          providerOptions: { reasoningEffort: "high" },
        }).model("openai-gpt-6-1-sol"),
        messages: [
          Message.user("Reply RED"),
          Message.assistant("RED"),
          Message.effort({ previous: "low", effort: "high" }),
          Message.user("Reply exactly: BLUE"),
        ],
        generation: { maxTokens: 256 },
      })
      const compiled = yield* compileRequest(request)
      expect(compiled.body).toMatchObject({
        reasoning: { effort: "low" },
        input: expect.arrayContaining([{ type: "configuration_update", reasoning: { effort: "high" } }]),
      })
      const response = yield* LLMClient.generate(request)
      expect(response.text.trim()).toBe("BLUE")
    }),
  60_000,
)

recordedTests({
  prefix: "digitalocean-messages",
  provider: "digitalocean",
  protocol: "messages",
  requires: ["DIGITAL_OCEAN_OFFICIAL_API_KEY"],
}).effect.with(
  "replays signed visible thinking",
  { tags: ["reasoning", "continuation"], metadata: { model: "anthropic-claude-haiku-4.5" } },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: DigitalOcean.configure({
          apiKey: process.env.DIGITAL_OCEAN_OFFICIAL_API_KEY ?? "fixture",
          providerOptions: { thinking: { type: "enabled", budgetTokens: 1024, display: "summarized" } },
        }).model("anthropic-claude-haiku-4.5"),
        prompt: "Compute 173 multiplied by 219. Verify it, then reply with only the integer.",
        generation: { maxTokens: 2048 },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.text.replaceAll(",", "").trim()).toMatch(/37887$/)
      expect(first.reasoning.length).toBeGreaterThan(0)
      const second = yield* LLMClient.generate(
        LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            Message.user("Add 7 to that answer. Reply with only the integer."),
          ],
        }),
      )
      expect(second.text.replaceAll(",", "").trim()).toMatch(/37894$/)
    }),
  60_000,
)

recordedTests({
  prefix: "digitalocean-messages",
  provider: "digitalocean",
  protocol: "messages",
  requires: ["DIGITAL_OCEAN_OFFICIAL_API_KEY"],
}).effect.with(
  "delivers chronological system update text",
  { tags: ["system", "continuation"] },
  () =>
    Effect.gen(function* () {
      for (const id of ["anthropic-claude-sonnet-5.5", "anthropic-claude-opus-4.8"]) {
        const request = LLM.request({
          model: provider.model(id),
          system: "Answer questions about the conversation contents concisely.",
          messages: [
            Message.user("Hello"),
            Message.assistant("Hi"),
            Message.user("What reference word was just provided? Include the word in your answer."),
          Message.system("The session reference word is VIOLET."),
        ],
        generation: { maxTokens: 1024 },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: expect.arrayContaining([
                expect.objectContaining({ type: "text", text: "The session reference word is VIOLET." }),
              ]),
            }),
          ]),
        })
        const response = yield* LLMClient.generate(request)
        // Check delivery and visibility, not whether this update overrides conflicting instructions.
        expect(response.text).toMatch(/VIOLET/i)
      }
    }),
  60_000,
)
