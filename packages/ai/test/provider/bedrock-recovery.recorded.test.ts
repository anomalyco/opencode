import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AIError, LLM, LLMEvent, Message, ToolCallPart, ToolDefinition } from "../../src/index.js"
import { configure } from "../../src/providers/amazon-bedrock.js"
import { LLMClient } from "../../src/route.js"
import { recordedTests } from "../recorded-test.js"

const model = configure({
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
  region: "us-east-2",
}).model("us.anthropic.claude-sonnet-4-6")
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
  prefix: "bedrock-recovery",
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
})

const history = (complete: boolean) => [
  Message.user("Look up the weather and local time in Paris."),
  Message.assistant([
    { type: "text" as const, text: "I should use both lookup tools." },
    ToolCallPart.make({ id: "call_weather", name: "lookup_weather", input: { city: "Paris" } }),
    ToolCallPart.make({ id: "call_time", name: "lookup_time", input: { city: "Paris" } }),
  ]),
  Message.tool({ id: "call_weather", name: "lookup_weather", result: "sunny", resultType: "text" }),
  ...(complete ? [Message.tool({ id: "call_time", name: "lookup_time", result: "12:00", resultType: "text" })] : []),
  Message.user(continuation),
]

describe("Bedrock Converse interrupted recovery recorded", () => {
  recorded.effect.with(
    "accepts settled parallel tools followed by continuation",
    { tags: ["tool", "parallel", "recovery", "bearer"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            id: "recorded_bedrock_interrupted_parallel_recovery",
            model,
            messages: history(true),
            tools,
            toolChoice: "none",
            generation: { maxTokens: 128, temperature: 0 },
          }),
        )

        expect(response.events.some(LLMEvent.is.finish)).toBe(true)
      }),
  )

  recorded.effect.with(
    "rejects continuation with a missing parallel tool result",
    { tags: ["tool", "parallel", "recovery", "bearer", "sad-path"] },
    () =>
      Effect.gen(function* () {
        const error = yield* LLMClient.generate(
          LLM.request({
            id: "recorded_bedrock_incomplete_parallel_recovery",
            model,
            messages: history(false),
            tools,
            toolChoice: "none",
            generation: { maxTokens: 32, temperature: 0 },
          }),
        ).pipe(Effect.flip)

        expect(error).toBeInstanceOf(AIError)
        expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      }),
  )
})
