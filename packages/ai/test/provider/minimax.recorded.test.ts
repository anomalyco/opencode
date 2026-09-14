import { describe, expect } from "bun:test"
import { Effect } from "effect"
import {
  LLM,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  ToolChoice,
  ToolDefinition,
  type LanguageModel,
} from "../../src/index.js"
import { MiniMax } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.MINIMAX_API_KEY ?? "fixture"
const minimax = MiniMax.configure({ apiKey })
const weather = ToolDefinition.make({
  name: "get_weather",
  description: "Get the current weather in a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

const textCases: ReadonlyArray<{
  name: string
  api: string
  protocol: string
  model: LanguageModel
  reasoning: boolean
  body: Record<string, unknown>
}> = [
  {
    name: "M3 streams text with thinking disabled",
    api: "messages",
    protocol: "anthropic-messages",
    model: MiniMax.configure({ apiKey, providerOptions: { thinking: { type: "disabled" } } }).model("MiniMax-M3"),
    reasoning: false,
    body: { thinking: { type: "disabled" } },
  },
  {
    name: "M3 streams adaptive thinking",
    api: "messages",
    protocol: "anthropic-messages",
    model: MiniMax.configure({ apiKey, providerOptions: { thinking: { type: "adaptive" } } }).messages("MiniMax-M3"),
    reasoning: true,
    body: { thinking: { type: "adaptive" } },
  },
  {
    name: "M2.7 streams default thinking",
    api: "messages",
    protocol: "anthropic-messages",
    model: minimax.model("MiniMax-M2.7"),
    reasoning: true,
    body: {},
  },
  {
    name: "M3 streams text with thinking disabled",
    api: "chat",
    protocol: "minimax-chat",
    model: MiniMax.configure({ apiKey, providerOptions: { thinking: { type: "disabled" } } }).chat("MiniMax-M3"),
    reasoning: false,
    body: { thinking: { type: "disabled" }, reasoning_split: true },
  },
  {
    name: "M3 streams text with effort none",
    api: "responses",
    protocol: "open-responses",
    model: MiniMax.configure({ apiKey, providerOptions: { reasoningEffort: "none" } }).responses("MiniMax-M3"),
    reasoning: false,
    body: { reasoning: { effort: "none" } },
  },
]

describe("MiniMax recorded", () => {
  for (const item of textCases) {
    const recorded = recordedTests({
      prefix: `minimax-${item.api}`,
      provider: "minimax",
      protocol: item.protocol,
      requires: ["MINIMAX_API_KEY"],
      metadata: { model: item.model.id },
    })
    recorded.effect.with(
      item.name,
      { tags: ["text", "usage", item.reasoning ? "reasoning" : "thinking-off"] },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: item.model,
            prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
            generation: { maxTokens: 1536 },
          })
          const compiled = yield* compileRequest(request)
          expect(compiled.body).toMatchObject(item.body)

          const response = yield* LLMClient.generate(request)
          expect(response.text.replaceAll(",", "").trim()).toBe("37887")
          expect(response.text).not.toContain("<think>")
          expect(response.reasoning.length > 0).toBe(item.reasoning)
          expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(item.reasoning)
          expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
          expectUsage(response)
        }),
      60_000,
    )
  }

  const messages = recordedTests({
    prefix: "minimax-messages",
    provider: "minimax",
    protocol: "anthropic-messages",
    requires: ["MINIMAX_API_KEY"],
    metadata: { model: "MiniMax-M3" },
  })

  messages.effect.with(
    "M3 generates a named tool call with default thinking off",
    { tags: ["tool", "thinking-off", "usage"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: minimax.model("MiniMax-M3"),
            prompt: "Use get_weather to look up the current weather in Paris.",
            tools: [weather],
            toolChoice: ToolChoice.named("get_weather"),
            generation: { maxTokens: 512 },
          }),
        )
        expect(response.finishReason.normalized).toBe("tool-calls")
        expect(response.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
        expect(response.reasoning).toBe("")
        expect(response.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
        expectUsage(response)
      }),
    60_000,
  )

  const loops: ReadonlyArray<{ api: string; protocol: string; mode: string; model: LanguageModel }> = [
    {
      api: "messages",
      protocol: "anthropic-messages",
      mode: "adaptive thinking",
      model: MiniMax.configure({ apiKey, providerOptions: { thinking: { type: "adaptive" } } }).model("MiniMax-M3"),
    },
    {
      api: "chat",
      protocol: "minimax-chat",
      mode: "default thinking",
      model: minimax.chat("MiniMax-M3"),
    },
    {
      api: "responses",
      protocol: "open-responses",
      mode: "effort minimal",
      model: MiniMax.configure({ apiKey, providerOptions: { reasoningEffort: "minimal" } }).responses("MiniMax-M3"),
    },
  ]

  for (const item of loops) {
    const recorded = recordedTests({
      prefix: `minimax-${item.api}`,
      provider: "minimax",
      protocol: item.protocol,
      requires: ["MINIMAX_API_KEY"],
      metadata: { model: item.model.id },
    })
    recorded.effect.with(
      `M3 continues a tool loop with ${item.mode}`,
      { tags: ["tool", "tool-loop", "reasoning", "continuation", "usage"] },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: item.model,
            prompt:
              "Look up the current weather in Paris using get_weather before answering. After receiving the result, report the weather in one short sentence.",
            tools: [weather],
            toolChoice: "auto",
            generation: { maxTokens: 1536 },
          })
          const first = yield* LLMClient.generate(request)
          expect(first.finishReason.normalized).toBe("tool-calls")
          expect(first.toolCalls).toHaveLength(1)
          expect(first.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
          expect(first.reasoning.length).toBeGreaterThan(0)
          expect(first.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
          expectUsage(first)

          const followUp = LLMRequest.update(request, {
            toolChoice: ToolChoice.make("none"),
            messages: [
              ...request.messages,
              first.message,
              ...first.toolCalls.map((call) =>
                Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
              ),
            ],
          })
          const replay = yield* compileRequest(followUp)
          const reasoning = first.message.content.filter((part) => part.type === "reasoning")
          if (item.api === "messages") {
            reasoning.forEach((part) => expect(part.providerMetadata?.minimax?.signature).toEqual(expect.any(String)))
            expect(replay.body.messages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  role: "assistant",
                  content: expect.arrayContaining(
                    reasoning.map((part) => ({
                      type: "thinking",
                      thinking: part.text,
                      signature: part.providerMetadata?.minimax?.signature,
                    })),
                  ),
                }),
              ]),
            )
          }
          if (item.api === "chat") {
            expect(replay.body.messages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  role: "assistant",
                  reasoning_content: first.reasoning,
                  reasoning_details: reasoning.flatMap(
                    (part) => part.providerMetadata?.minimax?.reasoningDetails ?? [],
                  ),
                }),
              ]),
            )
          }
          if (item.api === "responses") {
            expect(replay.body.input).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  type: "reasoning",
                  summary: expect.arrayContaining([{ type: "summary_text", text: first.reasoning }]),
                }),
              ]),
            )
          }

          const second = yield* LLMClient.generate(followUp)
          expect(second.finishReason.normalized).toBe("stop")
          expect(second.toolCalls).toHaveLength(0)
          expect(second.text).toContain("Paris")
          expect(second.text.toLowerCase()).toContain("sunny")
          expectUsage(second)
        }),
      120_000,
    )
  }
})

function expectUsage(response: LLMResponse) {
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
}
