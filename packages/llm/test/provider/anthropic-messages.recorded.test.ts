import { Redactor } from "@opencode-ai/http-recorder"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMError } from "../../src"
import { LLMClient } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { weatherToolName } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

const malformedToolOrderRequest = LLM.request({
  id: "recorded_anthropic_malformed_tool_order",
  model,
  messages: [
    LLM.assistant([
      LLM.toolCall({ id: "call_1", name: weatherToolName, input: { city: "Paris" } }),
      { type: "text", text: "I will check the weather." },
    ]),
    LLM.toolMessage({ id: "call_1", name: weatherToolName, result: { temperature: "72F" } }),
    LLM.user("Use that result to answer briefly."),
  ],
  tools: [{ name: weatherToolName, description: "Get weather", inputSchema: { type: "object", properties: {} } }],
})

const recorded = recordedTests({
  prefix: "anthropic-messages",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { redactor: Redactor.defaults({ requestHeaders: { allow: ["content-type", "anthropic-version"] } }) },
})

describe("Anthropic Messages sad-path recorded", () => {
  recorded.effect.with("rejects malformed assistant tool order", { tags: ["tool", "sad-path"] }, () =>
    Effect.gen(function* () {
      const error = yield* LLMClient.generate(malformedToolOrderRequest).pipe(Effect.flip)

      expect(error).toBeInstanceOf(LLMError)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest" })
      expect(error.message).toContain("HTTP 400")
    }),
  )
})
