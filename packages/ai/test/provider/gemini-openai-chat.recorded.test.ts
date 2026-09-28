import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolRuntime, toDefinitions } from "../../src/index.js"
import * as OpenAICompatible from "../../src/providers/openai-compatible.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"
import { weatherRuntimeTool, weatherToolName } from "../recorded-scenarios.js"

const model = OpenAICompatible.configure({
  provider: "google",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
}).model("gemini-3.8-flash")

const recorded = recordedTests({
  prefix: "openai-compatible-chat",
  provider: "google",
  protocol: "openai-chat",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  tags: ["tool", "tool-loop", "continuation"],
  metadata: { model: model.id },
})

describe("Gemini OpenAI-compatible Chat recorded", () => {
  recorded.effect.with(
    "replays thought signatures through a parallel tool loop",
    { cassette: "openai-compatible-chat/gemini-parallel-tool-signatures" },
    () =>
      Effect.gen(function* () {
        const tools = { [weatherToolName]: weatherRuntimeTool }
        const request = LLM.request({
          model,
          system: "Call get_weather for every requested city in parallel, then answer in one short sentence.",
          prompt: "What is the weather in Paris and in Tokyo?",
          tools: toDefinitions(tools),
          cache: "none",
        })
        const first = yield* LLMClient.generate(request)
        const calls = first.events.filter(LLMEvent.is.toolCall)
        expect(calls.map((call) => call.input)).toEqual([{ city: "Paris" }, { city: "Tokyo" }])
        const extraContent = calls[0]?.providerMetadata?.google?.extraContent
        expect(extraContent).toEqual({ google: { thought_signature: expect.any(String) } })

        const results = yield* Effect.forEach(calls, (call) => ToolRuntime.dispatch(tools, call))
        const continuation = LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            ...calls.map((call, index) =>
              Message.tool({ id: call.id, name: call.name, result: results[index]!.result }),
            ),
          ],
        })
        const prepared = yield* compileRequest(continuation)
        const assistant = prepared.body.messages.find((message) => message.role === "assistant")
        expect(assistant?.role === "assistant" ? assistant.tool_calls?.[0]?.extra_content : undefined).toEqual(
          extraContent,
        )

        const second = yield* LLMClient.generate(continuation)
        expect(second.events.filter(LLMEvent.is.toolCall)).toHaveLength(0)
        expect(second.text).toMatch(/Paris/)
        expect(second.text).toMatch(/Tokyo/)
      }),
    60_000,
  )
})
