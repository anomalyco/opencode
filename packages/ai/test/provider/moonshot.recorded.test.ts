import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message, ToolDefinition, type LLMResponse } from "../../src/index.js"
import { Moonshot } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const apiKey = process.env.MOONSHOT_API_KEY ?? process.env.MOONSHOTAI_API_KEY ?? "fixture"
const requires = [process.env.MOONSHOT_API_KEY ? "MOONSHOT_API_KEY" : "MOONSHOTAI_API_KEY"]

for (const api of ["chat", "messages", "responses"] as const) {
  const recorded = recordedTests({ prefix: `moonshot-${api}`, provider: "moonshot", protocol: api, requires })

  for (const effort of [undefined, "low", "high", "max"] as const) {
    recorded.effect.with(
      `K3 streams text with ${effort ?? "default"} effort`,
      { tags: ["text", "reasoning", "usage"], metadata: { model: "kimi-k3" } },
      () =>
        Effect.gen(function* () {
          const request = LLM.request({
            model: Moonshot.configure({
              apiKey,
              providerOptions: api === "messages" ? { effort } : { reasoningEffort: effort },
            })[api]("kimi-k3"),
            prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
            generation: { maxTokens: 4096 },
          })
          const compiled = yield* compileRequest(request)
          expect(compiled.body.thinking).toBeUndefined()
          if (effort !== undefined) {
            expect(compiled.body).toMatchObject(
              api === "chat"
                ? { reasoning_effort: effort }
                : api === "messages"
                  ? { output_config: { effort } }
                  : { reasoning: { effort } },
            )
          }
          const response = yield* LLMClient.generate(request)
          expect(response.text.replaceAll(",", "")).toContain("37887")
          expect(response.reasoning.length).toBeGreaterThan(0)
          expect(response.finishReason.normalized).toBe("stop")
          expect(response.events.some(LLMEvent.is.reasoningDelta)).toBe(true)
          expectUsage(response)
        }),
      120_000,
    )
  }
}

const chat = recordedTests({ prefix: "moonshot-chat", provider: "moonshot", protocol: "moonshot-chat", requires })
for (const item of [
  { model: "kimi-k2.6", name: "default thinking", thinking: undefined },
  { model: "kimi-k2.6", name: "disabled thinking", thinking: { type: "disabled" } },
  { model: "kimi-k2.6", name: "enabled thinking", thinking: { type: "enabled", keep: null } },
  { model: "kimi-k2.7-code", name: "default thinking", thinking: undefined },
  { model: "kimi-k2.7-code-highspeed", name: "default thinking", thinking: undefined },
]) {
  chat.effect.with(
    `${item.model} streams text with ${item.name}`,
    {
      tags: ["text", "usage", item.thinking?.type === "disabled" ? "thinking-off" : "reasoning"],
      metadata: { model: item.model },
    },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            model: Moonshot.configure({ apiKey, providerOptions: { thinking: item.thinking } }).chat(item.model),
            prompt: "What is 173 multiplied by 219? Reply with only the final integer.",
            generation: { maxTokens: 4096 },
          }),
        )
        expect(response.text.replaceAll(",", "")).toContain("37887")
        expect(response.reasoning.length > 0).toBe(item.thinking?.type !== "disabled")
        expect(response.finishReason.normalized).toBe("stop")
        expectUsage(response)
      }),
    120_000,
  )
}

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

for (const item of [
  { api: "chat", model: "kimi-k3", options: { reasoningEffort: "low" } },
  { api: "messages", model: "kimi-k3", options: { effort: "low" } },
  { api: "responses", model: "kimi-k3", options: { reasoningEffort: "low" } },
  { api: "chat", model: "kimi-k2.6", options: { thinking: { type: "enabled", keep: "all" } } },
  { api: "chat", model: "kimi-k2.7-code", options: {} },
  { api: "chat", model: "kimi-k2.7-code-highspeed", options: {} },
] as const) {
  const recorded = recordedTests({ prefix: `moonshot-${item.api}`, provider: "moonshot", protocol: item.api, requires })
  recorded.effect.with(
    `${item.model} preserves reasoning through a tool loop and follow-up`,
    { tags: ["tool", "tool-loop", "reasoning", "continuation", "usage"], metadata: { model: item.model } },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: Moonshot.configure({ apiKey, providerOptions: item.options })[item.api](item.model),
          prompt:
            "Use get_weather to look up the current weather in Paris. After receiving the result, report the weather in one short sentence.",
          tools: [weather],
          generation: { maxTokens: 4096 },
        })
        const first = yield* LLMClient.generate(request)
        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.toolCalls).toMatchObject([{ name: "get_weather", input: { city: "Paris" } }])
        expect(first.reasoning.length).toBeGreaterThan(0)
        expectUsage(first)
        const continuation = LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            ...first.toolCalls.map((call) =>
              Message.tool({ id: call.id, name: call.name, result: { condition: "sunny", temperature: "18C" } }),
            ),
          ],
        })
        const compiled = yield* compileRequest(continuation)
        if (item.api === "chat")
          expect(compiled.body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ role: "assistant", reasoning_content: first.reasoning }),
            ]),
          )
        if (item.api === "messages")
          expect(compiled.body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                role: "assistant",
                content: expect.arrayContaining(
                  first.message.content
                    .filter((part) => part.type === "reasoning")
                    .map((part) => ({
                      type: "thinking",
                      thinking: part.text,
                      signature: part.providerMetadata?.moonshot?.signature ?? "",
                    })),
                ),
              }),
            ]),
          )
        if (item.api === "responses")
          expect(compiled.body.input).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "reasoning",
                summary: expect.arrayContaining([{ type: "summary_text", text: first.reasoning }]),
              }),
            ]),
          )
        const second = yield* LLMClient.generate(continuation)
        expect(second.text).toContain("Paris")
        expect(second.text.toLowerCase()).toContain("sunny")
        expect(second.toolCalls).toHaveLength(0)
        expect(second.finishReason.normalized).toBe("stop")
        expectUsage(second)
        const third = yield* LLMClient.generate(
          LLMRequest.update(continuation, {
            messages: [
              ...continuation.messages,
              second.message,
              Message.user("What temperature did the tool report? Reply with only the temperature."),
            ],
          }),
        )
        expect(third.text).toContain("18")
        expect(third.toolCalls).toHaveLength(0)
        expect(third.finishReason.normalized).toBe("stop")
        expectUsage(third)
      }),
    180_000,
  )
}

function expectUsage(response: LLMResponse) {
  expect(response.usage?.inputTokens).toBeGreaterThan(0)
  expect(response.usage?.outputTokens).toBeGreaterThan(0)
  expect(response.events.filter(LLMEvent.is.finish)).toHaveLength(1)
}
