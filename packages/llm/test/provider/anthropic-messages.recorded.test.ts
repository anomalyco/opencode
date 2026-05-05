import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, ProviderPatch, ProviderRequestError, type PreparedRequestOf } from "../../src"
import type { AnthropicMessagesPayload } from "../../src/protocols/anthropic-messages"
import { LLMClient } from "../../src/adapter"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { eventSummary, expectWeatherToolLoop, runWeatherToolLoop, textRequest, weatherToolLoopRequest, weatherToolName, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

const flagshipModel = AnthropicMessages.model({
  id: "claude-opus-4-7",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

const request = textRequest({ id: "recorded_anthropic_messages_text", model })
const toolRequest = weatherToolRequest({ id: "recorded_anthropic_messages_tool_call", model })
const flagshipToolLoopRequest = weatherToolLoopRequest({
  id: "recorded_anthropic_messages_opus_4_7_tool_loop",
  model: flagshipModel,
  temperature: false,
})

const recorded = recordedTests({
  prefix: "anthropic-messages",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { requestHeaders: ["content-type", "anthropic-version"] },
})
const anthropic = LLMClient.make({ adapters: [AnthropicMessages.adapter] })
const anthropicWithPatches = LLMClient.make({ adapters: [AnthropicMessages.adapter], patches: ProviderPatch.defaults })

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

  recorded.effect.with("claude opus 4.7 drives a tool loop", { tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(anthropic, flagshipToolLoopRequest))
    }),
  )

  recorded.effect.with("rejects malformed assistant tool order without patch", { tags: ["tool", "sad-path"] }, () =>
    Effect.gen(function* () {
      const error = yield* anthropic.generate(malformedToolOrderRequest).pipe(Effect.flip)

      expect(error).toBeInstanceOf(ProviderRequestError)
      expect(error).toMatchObject({ status: 400 })
      expect(error.message).toContain("HTTP 400")
    }),
  )

  recorded.effect.with("accepts malformed assistant tool order with default patch", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const prepared: PreparedRequestOf<AnthropicMessagesPayload> = yield* anthropicWithPatches.prepare<AnthropicMessagesPayload>(malformedToolOrderRequest)
      const response = yield* anthropicWithPatches.generate(malformedToolOrderRequest)

      expect(prepared.payload.messages.slice(0, 2)).toMatchObject([
        { role: "assistant", content: [{ type: "text", text: "I will check the weather." }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: weatherToolName }] },
      ])
      expect(response.events.at(-1)).toMatchObject({ type: "request-finish" })
    }),
  )
})
