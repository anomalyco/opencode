import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, Message, ToolCallPart, ToolDefinition } from "../../src/index.js"
import { configure } from "../../src/providers/xai.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const model = configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" }).responses("grok-4.6")
const continuation =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."
const tools = [
  ToolDefinition.make({
    name: "lookup_weather",
    description: "Return benign weather data for a city.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  }),
  ToolDefinition.make({
    name: "lookup_time",
    description: "Return the benign local time for a city.",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  }),
]
const recorded = recordedTests({
  prefix: "xai-recovery",
  provider: "xai",
  protocol: "openai-responses",
  requires: ["XAI_API_KEY"],
})

describe("xAI Responses interrupted recovery recorded", () => {
  recorded.effect.with(
    "accepts settled parallel tools followed by continuation",
    { tags: ["tool", "parallel", "recovery"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            id: "recorded_xai_interrupted_parallel_recovery",
            model,
            messages: [
              Message.user("Look up the weather and local time in Paris."),
              Message.assistant([
                { type: "text", text: "I should use both lookup tools." },
                ToolCallPart.make({ id: "call_weather", name: "lookup_weather", input: { city: "Paris" } }),
                ToolCallPart.make({ id: "call_time", name: "lookup_time", input: { city: "Paris" } }),
              ]),
              Message.tool({ id: "call_weather", name: "lookup_weather", result: "sunny", resultType: "text" }),
              Message.tool({ id: "call_time", name: "lookup_time", result: "12:00", resultType: "text" }),
              Message.user(continuation),
            ],
            tools,
            toolChoice: "none",
            generation: { maxTokens: 128 },
          }),
        )

        expect(response.events.some(LLMEvent.is.finish)).toBe(true)
      }),
  )
})
