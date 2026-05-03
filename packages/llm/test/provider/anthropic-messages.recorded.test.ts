import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { AnthropicMessages } from "../../src/provider/anthropic-messages"
import { expectFinish, expectWeatherToolCall, expectWeatherToolLoop, runWeatherToolLoop, textRequest, weatherToolLoopRequest, weatherToolRequest } from "../recorded-scenarios"
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

describe("Anthropic Messages recorded", () => {
  recorded.effect("streams text", () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(request)

      expect(LLM.outputText(response)).toBe("Hello!")
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* anthropic.generate(toolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("claude opus 4.7 drives a tool loop", { tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(anthropic, flagshipToolLoopRequest))
    }),
  )
})
