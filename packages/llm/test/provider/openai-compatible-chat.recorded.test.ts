import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { expectFinish, expectWeatherToolCall, expectWeatherToolLoop, runWeatherToolLoop, textRequest, weatherToolLoopRequest, weatherToolRequest } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const deepseekModel = OpenAICompatibleChat.deepseek({
  id: "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY ?? "fixture",
})

const deepseekRequest = textRequest({ id: "recorded_deepseek_text", model: deepseekModel })

const togetherModel = OpenAICompatibleChat.togetherai({
  id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  apiKey: process.env.TOGETHER_AI_API_KEY ?? "fixture",
})

const togetherRequest = textRequest({ id: "recorded_togetherai_text", model: togetherModel })
const togetherToolRequest = weatherToolRequest({ id: "recorded_togetherai_tool_call", model: togetherModel })

const openrouterModel = OpenAICompatibleChat.openrouter({
  id: "openai/gpt-4o-mini",
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const openrouterRequest = textRequest({ id: "recorded_openrouter_text", model: openrouterModel })
const openrouterToolRequest = weatherToolRequest({ id: "recorded_openrouter_tool_call", model: openrouterModel })

const openrouterGpt55Model = OpenAICompatibleChat.openrouter({
  id: "openai/gpt-5.5",
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const openrouterOpus47Model = OpenAICompatibleChat.openrouter({
  id: "anthropic/claude-opus-4.7",
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const recorded = recordedTests({ prefix: "openai-compatible-chat", protocol: "openai-compatible-chat" })
const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] })

const openrouterToolLoops = [
  {
    name: "openrouter gpt-4o-mini drives a tool loop",
    id: "recorded_openrouter_gpt_4o_mini_tool_loop",
    model: openrouterModel,
    tags: ["tool", "tool-loop", "golden"],
  },
  {
    name: "openrouter gpt-5.5 drives a tool loop",
    id: "recorded_openrouter_gpt_5_5_tool_loop",
    model: openrouterGpt55Model,
    tags: ["tool", "tool-loop", "golden", "flagship"],
  },
  {
    name: "openrouter claude opus 4.7 drives a tool loop",
    id: "recorded_openrouter_claude_opus_4_7_tool_loop",
    model: openrouterOpus47Model,
    tags: ["tool", "tool-loop", "golden", "flagship"],
  },
] as const

describe("OpenAI-compatible Chat recorded", () => {
  recorded.effect.with("deepseek streams text", { provider: "deepseek", requires: ["DEEPSEEK_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(deepseekRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("togetherai streams text", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("togetherai streams tool call", { provider: "togetherai", requires: ["TOGETHER_AI_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(togetherToolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("openrouter streams text", { provider: "openrouter", requires: ["OPENROUTER_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(openrouterRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("openrouter streams tool call", { provider: "openrouter", requires: ["OPENROUTER_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(openrouterToolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  openrouterToolLoops.forEach((scenario) =>
    recorded.effect.with(scenario.name, { provider: "openrouter", requires: ["OPENROUTER_API_KEY"], tags: scenario.tags }, () =>
      Effect.gen(function* () {
        expectWeatherToolLoop(yield* runWeatherToolLoop(llm, weatherToolLoopRequest({
          id: scenario.id,
          model: scenario.model,
          system: "Use the get_weather tool exactly once, then answer in one short sentence.",
        })))
      }),
    ),
  )
})
