import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIResponses } from "../../src/provider/openai-responses"
import { expectFinish, expectWeatherToolCall, expectWeatherToolLoop, runWeatherToolLoop, weatherTool, weatherToolLoopRequest, weatherToolName } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = OpenAIResponses.model({
  id: "gpt-5.5",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const textRequest = LLM.request({
  id: "recorded_openai_responses_text",
  model,
  system: "You are concise.",
  prompt: "Reply with exactly: Hello!",
  generation: { maxTokens: 80 },
})

const toolRequest = LLM.request({
  id: "recorded_openai_responses_tool_call",
  model,
  system: "Call tools exactly as requested.",
  prompt: "Call get_weather with city exactly Paris.",
  tools: [weatherTool],
  toolChoice: LLM.toolChoice(weatherTool),
  generation: { maxTokens: 80 },
})

const loopRequest = weatherToolLoopRequest({
  id: "recorded_openai_responses_gpt_5_5_tool_loop",
  model,
  temperature: false,
})

const recorded = recordedTests({
  prefix: "openai-responses",
  provider: "openai",
  protocol: "openai-responses",
  requires: ["OPENAI_API_KEY"],
})
const openai = LLMClient.make({ adapters: [OpenAIResponses.adapter] })

describe("OpenAI Responses recorded", () => {
  recorded.effect.with("gpt-5.5 streams text", { tags: ["flagship"] }, () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(textRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expect(response.usage?.totalTokens).toBeGreaterThan(0)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("gpt-5.5 streams tool call", { tags: ["tool", "flagship"] }, () =>
    Effect.gen(function* () {
      const response = yield* openai.generate(toolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expect(response.events.find((event) => event.type === "tool-call")).toMatchObject({
        type: "tool-call",
        name: weatherToolName,
        input: { city: "Paris" },
      })
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("gpt-5.5 drives a tool loop", { tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(openai, loopRequest))
    }),
  )
})
