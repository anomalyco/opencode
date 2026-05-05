import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/adapter"
import { OpenAICompatibleChat } from "../../src/provider/openai-compatible-chat"
import { OpenRouter } from "../../src/provider/openrouter"
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

const groqModel = OpenAICompatibleChat.groq({
  id: "llama-3.3-70b-versatile",
  apiKey: process.env.GROQ_API_KEY ?? "fixture",
})

const groqRequest = textRequest({ id: "recorded_groq_text", model: groqModel })
const groqToolRequest = weatherToolRequest({ id: "recorded_groq_tool_call", model: groqModel })

const openrouterModel = OpenRouter.model("openai/gpt-4o-mini", {
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const openrouterRequest = textRequest({ id: "recorded_openrouter_text", model: openrouterModel })
const openrouterToolRequest = weatherToolRequest({ id: "recorded_openrouter_tool_call", model: openrouterModel })

const openrouterGpt55Model = OpenRouter.model("openai/gpt-5.5", {
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const openrouterOpus47Model = OpenRouter.model("anthropic/claude-opus-4.7", {
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
})

const xaiModel = OpenAICompatibleChat.xai({
  id: "grok-3-mini",
  apiKey: process.env.XAI_API_KEY ?? "fixture",
})

const xaiFlagshipModel = OpenAICompatibleChat.xai({
  id: "grok-4.3",
  apiKey: process.env.XAI_API_KEY ?? "fixture",
})

const xaiRequest = textRequest({ id: "recorded_xai_text", model: xaiModel })
const xaiToolRequest = weatherToolRequest({ id: "recorded_xai_tool_call", model: xaiModel })

const recorded = recordedTests({ prefix: "openai-compatible-chat", protocol: "openai-compatible-chat" })
const llm = LLMClient.make({ adapters: [OpenAICompatibleChat.adapter, ...OpenRouter.adapters] })

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

  recorded.effect.with("groq streams text", { provider: "groq", requires: ["GROQ_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(groqRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("groq streams tool call", { provider: "groq", requires: ["GROQ_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(groqToolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("groq llama 3.3 70b drives a tool loop", { provider: "groq", requires: ["GROQ_API_KEY"], tags: ["tool", "tool-loop", "golden"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(llm, weatherToolLoopRequest({
        id: "recorded_groq_llama_3_3_70b_tool_loop",
        model: groqModel,
      })))
    }),
    30_000,
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

  recorded.effect.with("xai streams text", { provider: "xai", requires: ["XAI_API_KEY"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(xaiRequest)

      expect(LLM.outputText(response)).toMatch(/^Hello!?$/)
      expectFinish(response.events, "stop")
    }),
  )

  recorded.effect.with("xai streams tool call", { provider: "xai", requires: ["XAI_API_KEY"], tags: ["tool"] }, () =>
    Effect.gen(function* () {
      const response = yield* llm.generate(xaiToolRequest)

      expect(response.events.some((event) => event.type === "tool-input-delta")).toBe(true)
      expectWeatherToolCall(response)
      expectFinish(response.events, "tool-calls")
    }),
  )

  recorded.effect.with("xai grok 4.3 drives a tool loop", { provider: "xai", requires: ["XAI_API_KEY"], tags: ["tool", "tool-loop", "golden", "flagship"] }, () =>
    Effect.gen(function* () {
      expectWeatherToolLoop(yield* runWeatherToolLoop(llm, weatherToolLoopRequest({
        id: "recorded_xai_grok_4_3_tool_loop",
        model: xaiFlagshipModel,
      })))
    }),
    30_000,
  )
})
