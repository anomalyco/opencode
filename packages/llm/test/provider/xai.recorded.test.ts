import { describe, expect } from "bun:test"
import { Effect } from "effect"
import type { LLMRequest } from "../../src"
import { LLMClient } from "../../src/adapter"
import * as XAI from "../../src/providers/xai"
import { expectFinish, expectWeatherToolCall, expectWeatherToolLoop, runWeatherToolLoop, textRequest, weatherToolLoopRequest, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = XAI.model("grok-4.3", {
  apiKey: process.env.XAI_API_KEY ?? "fixture",
})

const basicModel = XAI.model("grok-3-mini", {
  apiKey: process.env.XAI_API_KEY ?? "fixture",
})

const recorded = recordedTests({
  prefix: "xai",
  provider: "xai",
  protocol: "openai-responses",
  requires: ["XAI_API_KEY"],
})

const generate = (request: LLMRequest) =>
  Effect.gen(function* () {
    return yield* LLMClient.generate(request)
  })

describe("xAI recorded", () => {
  recorded.effect("grok streams text", () =>
    Effect.gen(function* () {
      const response = yield* generate(textRequest({ id: "recorded_xai_text", model: basicModel }))

      expect(response.text).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("grok streams tool call", { tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* generate(weatherToolRequest({ id: "recorded_xai_tool_call", model: basicModel }))

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("grok drives a tool loop", { tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(weatherToolLoopRequest({
        id: "recorded_xai_grok_tool_loop",
        model,
      })))
    }),
    30_000,
  )
})
