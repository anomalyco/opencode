import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message, ToolDefinition } from "../../src/index.js"
import { ZAI } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.ZAI_API_KEY ?? "fixture"
const recorded = recordedTests({ prefix: "zai-chat", provider: "zai", protocol: "zai-chat", requires: ["ZAI_API_KEY"] })

recorded.effect.with(
  "GLM 5.3 rejects disabled thinking",
  { tags: ["thinking", "model-specific", "error"] },
  () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(
        LLM.request({
          model: ZAI.configure({ apiKey, providerOptions: { thinking: { type: "disabled" } } }).chat("glm-5.3"),
          prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
          generation: { maxTokens: 4096 },
        }),
      ).pipe(Effect.flip)
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.reason.http?.status).toBe(400)
      expect(error.message).toContain("always engages in thinking and cannot be disabled")
    }),
  120_000,
)

for (const modelID of ["glm-4.7", "glm-5.2"]) {
  for (const type of ["enabled", "disabled"] as const) {
    recorded.effect.with(
      `${modelID} streams thinking ${type}`,
      { tags: ["text", "thinking", "usage"] },
      () =>
        Effect.gen(function* () {
          const response = yield* LLMClient.generate(
            LLM.request({
              model: ZAI.configure({ apiKey, providerOptions: { thinking: { type, clear_thinking: true } } }).chat(
                modelID,
              ),
              prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
              generation: { maxTokens: 4096 },
            }),
          )
          expect(response.text.replaceAll(",", "")).toContain("37887")
          expect(response.reasoning.length > 0).toBe(type === "enabled")
          expect(response.finishReason.normalized).toBe("stop")
          expect(response.usage?.inputTokens).toBeGreaterThan(0)
          expect(response.usage?.outputTokens).toBeGreaterThan(0)
        }),
      120_000,
    )
  }
}

for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
  recorded.effect.with(
    `GLM 5.2 streams ${effort} effort`,
    { tags: ["text", "effort", "usage"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: ZAI.configure({ apiKey, providerOptions: { reasoningEffort: effort } }).chat("glm-5.2"),
            prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
            generation: { maxTokens: 4096 },
          }),
        )
        expect(response.text.replaceAll(",", "")).toContain("37887")
        // The direct API still returned reasoning for none/minimal in these recordings.
        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.usage?.inputTokens).toBeGreaterThan(0)
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
      }),
    120_000,
  )
}

recorded.effect.with(
  "GLM 5.3 Flash reads image bytes",
  { tags: ["image", "reasoning"] },
  () =>
    Effect.gen(function* () {
      const bytes = yield* Effect.promise(() =>
        Bun.file(new URL("../fixtures/media/restroom.png", import.meta.url)).bytes(),
      )
      const response = yield* LLMClient.generate(
        LLM.request({
          model: ZAI.configure({ apiKey, providerOptions: { reasoningEffort: "low" } }).chat("glm-5.3-flash"),
          messages: [
            Message.user([
              { type: "text", text: "Read the three words in this image. Reply with only the words in order." },
              { type: "media", mediaType: "image/png", data: bytes },
            ]),
          ],
          generation: { maxTokens: 4096 },
        }),
      )
      expect(response.text.toLowerCase()).toContain("jiggling restroom prison")
      expect(response.finishReason.normalized).toBe("stop")
      expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
    }),
  120_000,
)

recorded.effect.with(
  "GLM 5.3 returns a JSON object",
  { tags: ["structured-output"] },
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: ZAI.configure({
            apiKey,
            providerOptions: { reasoningEffort: "low", responseFormat: { type: "json_object" } },
          }).chat("glm-5.3"),
          prompt: 'Return a JSON object with one key "city" set to the capital city of France.',
          generation: { maxTokens: 4096 },
        }),
      )
      expect(JSON.parse(response.text)).toEqual({ city: "Paris" })
      expect(response.finishReason.normalized).toBe("stop")
    }),
  120_000,
)

recorded.effect.with(
  "GLM 4.5 calls a tool without streaming arguments",
  { tags: ["tool", "legacy"] },
  () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: ZAI.configure({ apiKey }).chat("glm-4.5"),
          prompt: "Use get_weather to look up the current weather in Paris.",
          tools: [
            ToolDefinition.make({
              name: "get_weather",
              description: "Get weather in a city",
              inputSchema: {
                type: "object",
                properties: { city: { type: "string", enum: ["Paris"] } },
                required: ["city"],
              },
            }),
          ],
          generation: { maxTokens: 4096 },
        }),
      )
      expect(response.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
      expect(response.finishReason.normalized).toBe("tool-calls")
    }),
  120_000,
)
