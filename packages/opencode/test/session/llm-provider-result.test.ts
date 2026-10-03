import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LLMAISDK } from "../../src/session/llm/ai-sdk"
import { testEffect } from "../lib/effect"
import { streamText } from "ai"
import { provider, response, call, result, unavailable, executor } from "../fixture/advisor"

const it = testEffect(Layer.empty)

it.effect("preserves a provider result name without a call in the same stream", () =>
  Effect.gen(function* () {
    const events = yield* LLMAISDK.toLLMEvents(LLMAISDK.adapterState(), {
      type: "tool-result",
      toolName: "advisor",
      toolCallId: "srvtoolu_previous_response",
      input: {},
      output: { type: "advisor_result", text: "Use bounded concurrency." },
      providerExecuted: true,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "tool-result",
      id: "srvtoolu_previous_response",
      name: "advisor",
      result: {
        type: "json",
        value: { type: "advisor_result", text: "Use bounded concurrency." },
      },
      providerExecuted: true,
    })
  }),
)

it.effect("preserves raw pause reasons and raw Anthropic usage", () =>
  Effect.gen(function* () {
    const fixture = provider([response([call], "pause_turn")])
    const stream = streamText({
      model: fixture.client(executor),
      tools: { advisor: fixture.advisor },
      messages: [{ role: "user", content: "Inspect fixture" }],
    })
    const events = yield* Effect.promise(() => Array.fromAsync(stream.fullStream))
    const state = LLMAISDK.adapterState()
    const adapted = (yield* Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event))).flat()
    expect(adapted.find((event) => event.type === "step-finish")).toMatchObject({
      reason: "stop",
      providerMetadata: {
        opencode: { rawFinishReason: "pause_turn" },
        anthropic: {
          usage: {
            iterations: expect.arrayContaining([
              expect.objectContaining({ type: "advisor_message", input_tokens: 1000 }),
            ]),
          },
        },
      },
    })
  }),
)

it.effect("keeps an advisor failure as a structured provider outcome", () =>
  Effect.gen(function* () {
    const fixture = provider([response([call, result(unavailable)])])
    const stream = streamText({
      model: fixture.client(executor),
      tools: { advisor: fixture.advisor },
      messages: [{ role: "user", content: "Inspect fixture" }],
    })
    const events = yield* Effect.promise(() => Array.fromAsync(stream.fullStream))
    const state = LLMAISDK.adapterState()
    const adapted = (yield* Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event))).flat()
    expect(adapted.find((event) => event.type === "tool-result")).toMatchObject({
      name: "advisor",
      providerExecuted: true,
      result: { type: "error", value: unavailable },
    })
    expect(adapted.some((event) => event.type === "tool-error")).toBe(false)
  }),
)
