import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, AIError, Message, ToolCallPart } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import * as Anthropic from "../../src/providers/anthropic.js"
import { weatherToolName } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const model = Anthropic.configure({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
}).model("claude-haiku-4-5-20251001")

const malformedToolOrderRequest = LLM.request({
  id: "recorded_anthropic_malformed_tool_order",
  model,
  messages: [
    Message.assistant([
      ToolCallPart.make({ id: "call_1", name: weatherToolName, input: { city: "Paris" } }),
      { type: "text", text: "I will check the weather." },
    ]),
    Message.tool({ id: "call_1", name: weatherToolName, result: { temperature: "72F" } }),
    Message.user("Use that result to answer briefly."),
  ],
  tools: [{ name: weatherToolName, description: "Get weather", inputSchema: { type: "object", properties: {} } }],
})

const recorded = recordedTests({
  prefix: "anthropic-messages",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { redact: { allowRequestHeaders: ["anthropic-version"] } },
})

describe("Anthropic Messages sad-path recorded", () => {
  recorded.effect.with("rejects malformed assistant tool order", { tags: ["tool", "sad-path"] }, () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(malformedToolOrderRequest).pipe(Effect.flip)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect(error.message).toContain("HTTP 400")
    }),
  )
})
