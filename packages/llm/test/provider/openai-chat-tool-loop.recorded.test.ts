import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { tool } from "../../src/tool"
import { ToolRuntime } from "../../src/tool-runtime"
import { recordedTests } from "../recorded-test"

// Multi-interaction recorded test: drives the typed `ToolRuntime` against a
// live OpenAI Chat endpoint so the cassette captures every model round in
// order (model -> tool dispatch -> model). The cassette is only created with
// `RECORD=true OPENAI_API_KEY=...`. In replay mode the test is skipped if the
// cassette is missing — see `recordedTests` for the gate.

const model = OpenAIChat.model({
  id: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

const get_weather = tool({
  description: "Get current weather for a city.",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({ temperature: Schema.Number, condition: Schema.String }),
  execute: ({ city }) =>
    Effect.succeed(
      city === "Paris"
        ? { temperature: 22, condition: "sunny" }
        : { temperature: 0, condition: "unknown" },
    ),
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
const openai = LLMClient.make({ adapters: [OpenAIChat.adapter] })

describe("OpenAI Chat tool-loop recorded", () => {
  recorded.effect.with("drives a tool loop end-to-end", { tags: ["tool", "tool-loop"] }, () =>
    Effect.gen(function* () {
      const events = Array.from(
        yield* ToolRuntime.run(openai, { request, tools: { get_weather } }).pipe(Stream.runCollect),
      )

      // Two model rounds: tool-call + tool-result + final answer. Two
      // `request-finish` events confirm both interactions in the cassette
      // were dispatched in order.
      const finishes = events.filter(LLMEvent.guards["request-finish"])
      expect(finishes).toHaveLength(2)
      expect(finishes[0]?.reason).toBe("tool-calls")
      expect(finishes.at(-1)?.reason).toBe("stop")

      const toolResult = events.find(LLMEvent.guards["tool-result"])
      expect(toolResult).toMatchObject({
        type: "tool-result",
        name: "get_weather",
        result: { type: "json", value: { temperature: 22, condition: "sunny" } },
      })

      expect(LLM.outputText({ events })).toContain("Paris")
    }),
  )
})
