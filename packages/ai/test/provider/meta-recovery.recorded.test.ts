import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AIError, LLM, LLMEvent, Message, ToolCallPart, ToolDefinition } from "../../src/index.js"
import { configure } from "../../src/providers/openai.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const model = configure({
  apiKey: process.env.META_API_KEY ?? "fixture",
  baseURL: "https://api.meta.ai/v1",
}).responses("muse-spark-1.2")
const continuation =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."
const lookup = ToolDefinition.make({
  name: "lookup_weather",
  description: "Return benign weather data for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
})
const recorded = recordedTests({
  prefix: "meta-recovery",
  provider: "meta",
  protocol: "openai-responses",
  requires: ["META_API_KEY"],
})

const history = (settled: boolean) => [
  Message.user("Look up the weather in Paris."),
  Message.assistant([
    { type: "text" as const, text: "I should use the weather tool." },
    ToolCallPart.make({ id: "call_weather", name: "lookup_weather", input: { city: "Paris" } }),
  ]),
  ...(settled
    ? [Message.tool({ id: "call_weather", name: "lookup_weather", result: "sunny", resultType: "text" })]
    : []),
  Message.user(continuation),
]

describe("Meta Responses interrupted recovery recorded", () => {
  recorded.effect.with("accepts a settled tool followed by continuation", { tags: ["tool", "recovery"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_meta_interrupted_tool_recovery",
          model,
          messages: history(true),
          tools: [lookup],
          generation: { maxTokens: 128 },
        }),
      )

      expect(response.events.some(LLMEvent.is.finish)).toBe(true)
    }),
  )

  recorded.effect.with("rejects continuation with an unresolved tool", { tags: ["tool", "recovery", "sad-path"] }, () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_meta_unresolved_tool_recovery",
          model,
          messages: history(false),
          tools: [lookup],
          generation: { maxTokens: 32 },
        }),
      ).pipe(Effect.flip)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect(error.reason.message).toContain("No tool output found")
    }),
  )
})
