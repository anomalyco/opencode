import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM, LLMEvent, type ModelRef } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { ToolRuntime } from "../../src/tool-runtime"
import { expectFinish, expectWeatherToolCall, textRequest, weatherRuntimeTool, weatherToolRequest } from "../recorded-scenarios"
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

const openrouterToolLoopRequest = (input: { readonly id: string; readonly model: ModelRef }) =>
  LLM.request({
    id: input.id,
    model: input.model,
    system: "Use the get_weather tool exactly once, then answer in one short sentence.",
    prompt: "What is the weather in Paris?",
    generation: { maxTokens: 200 },
  })

const recorded = recordedTests({ prefix: "openai-compatible-chat", protocol: "openai-compatible-chat" })
const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] })

const expectWeatherToolLoop = (events: ReadonlyArray<LLMEvent>) => {
  const finishes = events.filter(LLMEvent.is.requestFinish)
  expect(finishes).toHaveLength(2)
  expect(finishes[0]?.reason).toBe("tool-calls")
  expect(finishes.at(-1)?.reason).toBe("stop")

  expect(events.find(LLMEvent.is.toolResult)).toMatchObject({
    type: "tool-result",
    name: "get_weather",
    result: { type: "json", value: { temperature: 22, condition: "sunny" } },
  })
  expect(LLM.outputText({ events })).toContain("Paris")
}

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

  recorded.effect.with("openrouter gpt-4o-mini drives a tool loop", { provider: "openrouter", requires: ["OPENROUTER_API_KEY"], tags: ["tool", "tool-loop", "golden"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(Array.from(
        yield* ToolRuntime.run(llm, {
          request: openrouterToolLoopRequest({ id: "recorded_openrouter_gpt_4o_mini_tool_loop", model: openrouterModel }),
          tools: { get_weather: weatherRuntimeTool },
        }).pipe(Stream.runCollect),
      ))
    }),
  )

  recorded.effect.with("openrouter gpt-5.5 drives a tool loop", { provider: "openrouter", requires: ["OPENROUTER_API_KEY"], tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(Array.from(
        yield* ToolRuntime.run(llm, {
          request: openrouterToolLoopRequest({ id: "recorded_openrouter_gpt_5_5_tool_loop", model: openrouterGpt55Model }),
          tools: { get_weather: weatherRuntimeTool },
        }).pipe(Stream.runCollect),
      ))
    }),
  )

  recorded.effect.with("openrouter claude opus 4.7 drives a tool loop", { provider: "openrouter", requires: ["OPENROUTER_API_KEY"], tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(Array.from(
        yield* ToolRuntime.run(llm, {
          request: openrouterToolLoopRequest({ id: "recorded_openrouter_claude_opus_4_7_tool_loop", model: openrouterOpus47Model }),
          tools: { get_weather: weatherRuntimeTool },
        }).pipe(Stream.runCollect),
      ))
    }),
  )
})
