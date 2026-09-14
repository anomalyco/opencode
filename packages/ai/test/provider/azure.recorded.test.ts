import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message, ToolDefinition, ToolCallPart } from "../../src/index.js"
import { Azure } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME ?? "aiden-azury-group"

const chatModel = Azure.configure({
  resourceName,
  apiKey: process.env.AZURE_OPENAI_API_KEY ?? "fixture",
}).chat("gpt-5.6-luna")

const responsesModel = Azure.configure({
  resourceName,
  apiKey: process.env.AZURE_OPENAI_API_KEY ?? "fixture",
}).responses("gpt-5.6-luna")

const lookupWeather = ToolDefinition.make({
  name: "lookup_weather",
  description: "Look up the current weather for a city",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
})

const recorded = recordedTests({
  prefix: "azure",
  provider: "azure",
  requires: ["AZURE_OPENAI_API_KEY"],
})

describe("Azure OpenAI recorded", () => {
  recorded.effect("chat streams text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({ model: chatModel, prompt: "Reply with exactly one word: hello" }),
      )

      expect(response.text.toLowerCase()).toContain("hello")
    }),
  )

  recorded.effect("responses streams text", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({ model: responsesModel, prompt: "Reply with exactly one word: bonjour" }),
      )

      expect(response.text.toLowerCase()).toContain("bonjour")
    }),
  )

  recorded.effect("responses calls a tool", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: responsesModel,
          prompt: "What is the weather in Paris? Use the lookup_weather tool.",
          tools: [lookupWeather],
        }),
      )

      const call = response.toolCalls.find((part) => part.name === "lookup_weather")
      expect(call).toBeDefined()
      expect(call?.input).toMatchObject({ city: "Paris" })
    }),
  )

  recorded.effect("responses continues after a tool result", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          model: responsesModel,
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
