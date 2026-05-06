import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM } from "../../src"
import * as OpenAIChat from "../../src/protocols/openai-chat"
import { ToolRuntime } from "../../src/tool-runtime"
import { eventSummary, weatherRuntimeTool } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"
import * as TestToolRuntime from "../lib/tool-runtime"

// Multi-interaction recorded test: drives the typed `ToolRuntime` against a
// live OpenAI Chat endpoint so the cassette captures every model round in
// order (model -> tool dispatch -> model). The cassette is only created with
// `RECORD=true OPENAI_API_KEY=...`. In replay mode the test is skipped if the
// cassette is missing — see `recordedTests` for the gate.

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const request = LLM.request({
  id: "recorded_openai_chat_tool_loop",
  model,
  system: "Use the get_weather tool, then answer in one short sentence.",
  prompt: "What is the weather in Paris?",
  generation: { maxTokens: 80, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "openai-chat",
  provider: "openai",
  protocol: "openai-chat",
  requires: ["OPENAI_API_KEY"],
})
describe("OpenAI Chat tool-loop recorded", () => {
  recorded.effect.with("drives a tool loop end-to-end", { tags: ["tool", "tool-loop"] }, () =>
    Effect.gen(function* () {
      const events = Array.from(
        yield* TestToolRuntime.runTools({ request, tools: { get_weather: weatherRuntimeTool } }).pipe(Stream.runCollect),
      )

      expect(LLM.outputText({ events })).toContain("Paris")
      expect(eventSummary(events)).toEqual([
        { type: "tool-call", name: "get_weather", input: { city: "Paris" } },
        {
          type: "finish",
          reason: "tool-calls",
          usage: { inputTokens: 64, outputTokens: 14, reasoningTokens: 0, cacheReadInputTokens: 0, totalTokens: 78 },
        },
        { type: "tool-result", name: "get_weather", result: { type: "json", value: { temperature: 22, condition: "sunny" } } },
        { type: "text", value: expect.stringContaining("Paris") },
        {
          type: "finish",
          reason: "stop",
          usage: { inputTokens: 96, outputTokens: 15, reasoningTokens: 0, cacheReadInputTokens: 0, totalTokens: 111 },
        },
      ])
    }),
  )
})
