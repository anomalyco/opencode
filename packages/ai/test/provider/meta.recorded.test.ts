import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, LLMResponse, Message, ToolDefinition } from "../../src/index.js"
import { Meta } from "../../src/providers/meta.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const meta = Meta.configure({ apiKey: process.env.META_API_KEY ?? "fixture" })
const modelID = "muse-spark-1.3"
const weather = ToolDefinition.make({
  name: "lookup_weather",
  description: "Look up the current weather for a city",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string", enum: ["Paris"] } },
    required: ["city"],
    additionalProperties: false,
  },
})

for (const api of ["responses", "chat"] as const) {
  const recorded = recordedTests({
    prefix: `meta-${api}`,
    provider: "meta",
    protocol: api === "responses" ? "open-responses" : "openai-chat",
    requires: ["META_API_KEY"],
    metadata: { model: modelID },
  })

  describe(`Meta ${api} recorded`, () => {
    for (const effort of [undefined, "minimal", "low", "medium", "high", "xhigh", "max"]) {
      recorded.effect.with(
        `streams text with ${effort ?? "default"} reasoning`,
        { tags: ["text", "reasoning", "usage", `effort:${effort ?? "default"}`] },
        () =>
          Effect.gen(function* () {
            const request = LLM.request({
              model: meta[api](modelID),
              prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
              generation: { maxTokens: 1024 },
              providerOptions: {
                reasoningEffort: effort,
                ...(api === "responses" && effort === "high" ? { reasoningSummary: "auto" } : {}),
              },
            })
            const compiled = yield* compileRequest(request)
            expect(compiled.body).toMatchObject({ model: modelID, stream: true })
            if (api === "responses") {
              expect(compiled.body).toMatchObject({
                max_output_tokens: 1024,
                store: false,
                include: ["reasoning.encrypted_content"],
              })
              expect(compiled.body.reasoning?.effort).toBe(effort)
              if (effort === "high") expect(compiled.body.reasoning.summary).toBe("auto")
            }
            if (api === "chat") {
              expect(compiled.body).toMatchObject({
                max_completion_tokens: 1024,
                stream_options: { include_usage: true },
              })
              expect(compiled.body.reasoning_effort).toBe(effort)
              expect(compiled.body.max_tokens).toBeUndefined()
              expect(compiled.body.store).toBeUndefined()
            }

            const response = yield* LLMClient.generate(request)
            expect(response.text.replaceAll(",", "").trim()).toBe("37887")
            expect(response.finishReason.normalized).toBe("stop")
            expect(response.events.some(LLMEvent.is.textDelta)).toBe(true)
            expectUsage(response)
            if (api === "chat") expect(response.reasoning).toBe("")
            if (api === "responses") {
              const reasoning = response.message.content.find((part) => part.type === "reasoning")
              expect(reasoning?.providerMetadata?.meta?.reasoningEncryptedContent).toEqual(expect.stringMatching(/\S/))
            }
          }),
        90_000,
      )
    }

    recorded.effect.with(
      api === "responses" ? "replays encrypted reasoning through a tool loop" : "continues a generated tool call",
      { tags: ["tool", "tool-loop", "reasoning", "usage", "effort:low"] },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: meta[api](modelID),
            prompt:
              "Look up the current weather in Paris using lookup_weather before answering. After receiving the result, report Paris's weather in one short sentence.",
            tools: [weather],
            toolChoice: "auto",
            providerOptions: { reasoningEffort: "low" },
            generation: { maxTokens: 1024 },
          })
          const compiled = yield* compileRequest(request)
          expect(compiled.body.tool_choice).toBe("auto")
          expect(compiled.body.tools).toHaveLength(1)
          const first = yield* LLMClient.generate(request)
          expect(first.finishReason.normalized).toBe("tool-calls")
          expect(first.toolCalls).toHaveLength(1)
          expect(first.toolCalls[0]).toMatchObject({ name: "lookup_weather", input: { city: "Paris" } })
          expect(first.events.some(LLMEvent.is.toolInputDelta)).toBe(true)
          expectUsage(first)

          const followUp = LLMRequest.update(request, {
            messages: [
              ...request.messages,
              first.message,
              ...first.toolCalls.map((call) =>
                Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
              ),
            ],
          })
          const replay = yield* compileRequest(followUp)
          if (api === "responses") {
            const reasoning = first.message.content.find((part) => part.type === "reasoning")
            expect(reasoning?.providerMetadata?.meta?.reasoningEncryptedContent).toEqual(expect.stringMatching(/\S/))
            expect(replay.body.input).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  type: "reasoning",
                  summary: [],
                  encrypted_content: reasoning?.providerMetadata?.meta?.reasoningEncryptedContent,
                }),
                expect.objectContaining({
                  type: "function_call",
                  call_id: first.toolCalls[0]?.id,
                  name: "lookup_weather",
                  arguments: '{"city":"Paris"}',
                }),
                expect.objectContaining({
                  type: "function_call_output",
                  call_id: first.toolCalls[0]?.id,
                  output: '{"condition":"sunny","temperature":"18C"}',
                }),
              ]),
            )
          }
          if (api === "chat") {
            expect(first.reasoning).toBe("")
            expect(replay.body.messages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  role: "assistant",
                  tool_calls: [
                    expect.objectContaining({
                      id: first.toolCalls[0]?.id,
                      function: { name: "lookup_weather", arguments: '{"city":"Paris"}' },
                    }),
                  ],
                }),
                {
                  role: "tool",
                  tool_call_id: first.toolCalls[0]?.id,
                  content: '{"condition":"sunny","temperature":"18C"}',
                },
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
      90_000,
    )
  })
}

function expectUsage(response: LLMResponse) {
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.usage?.reasoningTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
  expect(response.events.filter(LLMEvent.is.stepFinish)).toHaveLength(1)
}
