import { describe } from "bun:test"
import { Effect } from "effect"
import { LLMClient } from "../../src/adapter"
import { OpenAIChat } from "../../src/provider/openai-chat"
import { expectWeatherToolLoop, runWeatherToolLoop, weatherToolLoopRequest } from "../recorded-scenarios"
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

const request = weatherToolLoopRequest({
  id: "recorded_openai_chat_tool_loop",
  model,
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
      // Two model rounds: tool-call + tool-result + final answer. Two
      // `request-finish` events confirm both interactions in the cassette
      // were dispatched in order.
      expectWeatherToolLoop(yield* runWeatherToolLoop(openai, request))
    }),
  )
})
