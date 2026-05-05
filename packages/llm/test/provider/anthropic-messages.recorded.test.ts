import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { AnthropicMessages } from "../../src/provider/anthropic-messages"
import { eventSummary, textRequest, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

const request = textRequest({ id: "recorded_anthropic_messages_text", model })
const toolRequest = weatherToolRequest({ id: "recorded_anthropic_messages_tool_call", model })

const recorded = recordedTests({
  prefix: "anthropic-messages",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { requestHeaders: ["content-type", "anthropic-version"] },
})
const anthropic = LLMClient.make({ adapters: [AnthropicMessages.adapter] })

describe("Anthropic Messages recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(request)

      expect(eventSummary(response.events)).toEqual([
        { type: "text", value: "Hello!" },
        { type: "finish", reason: "stop", usage: expect.objectContaining({ totalTokens: expect.any(Number) }) },
      ])
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(toolRequest)

      expect(eventSummary(response.events)).toEqual([
        { type: "tool-call", name: weatherToolName, input: { city: "Paris" } },
        { type: "finish", reason: "tool-calls", usage: expect.objectContaining({ totalTokens: expect.any(Number) }) },
      ])
    }),
  )
})
