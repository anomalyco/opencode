import { describe, expect } from "bun:test"
import { Effect } from "effect"

import { LLM, Message, ToolDefinition, ToolCallPart } from "../../src/index.js"
import { GoogleVertex } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const model = GoogleVertex.configure({
  apiKey: process.env.GOOGLE_VERTEX_API_KEY ?? "fixture",
}).model("gemini-3.5-flash")

const lookupWeather = ToolDefinition.make({
  name: "lookup_weather",
  description: "Look up the current weather for a city",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
})

const recorded = recordedTests({
  prefix: "google-vertex",
  provider: "google-vertex",
  protocol: "gemini",
  requires: ["GOOGLE_VERTEX_API_KEY"],
})

describe("Google Vertex Gemini recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Reply with exactly one word: hello" }))

      expect(response.text.toLowerCase()).toContain("hello")
    }),
  )

  recorded.effect("calls a tool", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model,
          prompt: "What is the weather in Paris? Use the lookup_weather tool.",
          tools: [lookupWeather],
        }),
      )

      const call = response.toolCalls.find((part) => part.name === "lookup_weather")
      expect(call).toBeDefined()
      expect(call?.input).toMatchObject({ city: "Paris" })
    }),
  )

  recorded.effect("continues after a tool result", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model,
          messages: [
            Message.user("What is the weather in Paris?"),
            Message.assistant([
              ToolCallPart.make({ id: "call_paris_1", name: "lookup_weather", input: { city: "Paris" } }),
            ]),
            Message.tool({
              id: "call_paris_1",
              name: "lookup_weather",
              result: "18C, light rain",
              resultType: "text",
            }),
          ],
          tools: [lookupWeather],
        }),
      )

      expect(response.text.length).toBeGreaterThan(0)
    }),
  )
})
