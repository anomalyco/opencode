import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message, ToolDefinition } from "../../src/index.js"
import { Moonshot } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.MOONSHOT_API_KEY ?? process.env.MOONSHOTAI_API_KEY ?? "fixture"
const requires = [process.env.MOONSHOT_API_KEY ? "MOONSHOT_API_KEY" : "MOONSHOTAI_API_KEY"]
const schema = {
  type: "object",
  properties: { city: { type: "string", enum: ["Paris"] } },
  required: ["city"],
  additionalProperties: false,
}
const weather = ToolDefinition.make({
  name: "get_weather",
  description: "Get the current weather in a city",
  inputSchema: schema,
})

for (const api of ["chat", "messages", "responses"] as const) {
  const model = Moonshot.configure({
    apiKey,
    providerOptions: api === "messages" ? { effort: "low" } : { reasoningEffort: "low" },
  })[api]("kimi-k3")
  const recorded = recordedTests({
    prefix: `moonshot-${api}`,
    provider: "moonshot",
    protocol: api,
    requires,
    metadata: { model: "kimi-k3" },
  })

  for (const toolChoice of ["required", "none"] as const) {
    recorded.effect.with(
      `K3 ${api === "responses" ? "rejects unsupported" : "respects"} tool choice ${toolChoice}`,
      { tags: ["tool", "tool-choice", api === "responses" ? "error" : "usage"] },
      () =>
        Effect.gen(function* () {
          const generate = LLMClient.generate(
            LLM.request({
              model,
              prompt: "Use get_weather to look up the current weather in Paris.",
              tools: [weather],
              toolChoice,
              generation: { maxTokens: 4096 },
            }),
          )
          if (api === "responses") {
            const error = yield* generate.pipe(Effect.flip)
            expect(error.reason._tag).toBe("InvalidRequest")
            expect(error.reason.http?.status).toBe(400)
            expect(error.message).toContain(`unsupported tool_choice value: "${toolChoice}"`)
            return
          }
          const response = yield* generate
          if (toolChoice === "required") {
            expect(response.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
            expect(response.finishReason.normalized).toBe("tool-calls")
          }
          if (toolChoice === "none") {
            expect(response.toolCalls).toHaveLength(0)
            expect(response.text.length).toBeGreaterThan(0)
            expect(response.finishReason.normalized).toBe("stop")
          }
          expect(response.usage?.inputTokens).toBeGreaterThan(0)
          expect(response.usage?.outputTokens).toBeGreaterThan(0)
        }),
      120_000,
    )
  }

  recorded.effect.with(
    "K3 reads image bytes",
    { tags: ["image", "reasoning", "usage"] },
    () =>
      Effect.gen(function* () {
        const image = yield* Effect.promise(() =>
          Bun.file(new URL("../fixtures/media/restroom.png", import.meta.url)).bytes(),
        )
        const response = yield* LLMClient.generate(
          LLM.request({
            model,
            messages: [
              Message.user([
                { type: "text", text: "Read the three words in this image. Reply only with those words in order." },
                { type: "media", mediaType: "image/png", data: image },
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
    "K3 returns native structured output",
    { tags: ["structured-output", "usage"] },
    () =>
      Effect.gen(function* () {
        const format = { type: "json_schema", name: "location", schema, strict: true }
        const response = yield* LLMClient.generate(
          LLM.request({
            model,
            prompt: "Return a JSON object containing the capital city of France.",
            generation: { maxTokens: 4096 },
            http: {
              body:
                api === "chat"
                  ? {
                      response_format: { type: "json_schema", json_schema: { name: "location", schema, strict: true } },
                    }
                  : api === "messages"
                    ? { output_config: { format: { type: "json_schema", schema } } }
                    : { text: { format } },
            },
          }),
        )
        expect(JSON.parse(response.text)).toEqual({ city: "Paris" })
        expect(response.finishReason.normalized).toBe("stop")
        expect(response.usage?.inputTokens).toBeGreaterThan(0)
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
      }),
    120_000,
  )
}
