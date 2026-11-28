import type { ProviderOptions } from "../../src/schema/index.js"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, LLMEvent, Message } from "../../src/effect.js"
import { Meta, OpenAI } from "../../src/providers.js"
import { openAICompatibleResponses } from "../../src/providers/openai-compatible-responses.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const compatible = (
  id: string,
  settings: { apiKey?: string; baseURL: string; provider?: string; providerOptions?: ProviderOptions },
) =>
  openAICompatibleResponses(settings.provider)
    .with({ apiKey: settings.apiKey, baseURL: settings.baseURL, providerOptions: settings.providerOptions })
    .model(id)

for (const model of [
  OpenAI.model("example-model", { apiKey: "test-key" }),
  compatible("example-model", { apiKey: "test-key", baseURL: "https://responses.example.test/v1" }),
]) {
  describe(`${model.api.protocol.id} message replay`, () => {
    const key = model.metadataKey

    it.effect("marks assistant text completed regardless of stored status", () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          ai.request({
            model,
            messages: [
              ...[undefined, "in_progress", "incomplete", "completed"].map((status, index) =>
                Message.make({
                  role: "assistant",
                  providerMetadata: { [key]: { status } },
                  content: [
                    {
                      type: "text",
                      text: `Saved ${index}`,
                      providerMetadata: { [key]: { itemId: `msg_${index}`, phase: "commentary", status } },
                    },
                    {
                      type: "text",
                      text: `Final ${index}`,
                      providerMetadata: { [key]: { itemId: `msg_final_${index}`, phase: "final_answer", status } },
                    },
                  ],
                }),
              ),
              Message.make({
                role: "user",
                content: [{ type: "text", text: "Continue" }],
                providerMetadata: { [key]: { status: "incomplete" } },
              }),
            ],
          }),
        )
        expect(prepared.body.input).toEqual([
          ...[0, 1, 2, 3].flatMap((index) => [
            {
              type: "message",
              role: "assistant",
              id: `msg_${index}`,
              phase: "commentary",
              status: "completed",
              content: [{ type: "output_text", text: `Saved ${index}` }],
            },
            {
              type: "message",
              role: "assistant",
              id: `msg_final_${index}`,
              phase: "final_answer",
              status: "completed",
              content: [{ type: "output_text", text: `Final ${index}` }],
            },
          ]),
          { type: "message", role: "user", status: "incomplete", content: [{ type: "input_text", text: "Continue" }] },
        ])
      }),
    )

    it.effect("replays truncated text as completed while retaining the response finish reason", () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(ai.request({ model, prompt: "Respond" })).pipe(
          Effect.provide(
            fixedResponse(
              sseEvents(
                {
                  type: "response.output_item.added",
                  item: { type: "message", id: "msg_partial", status: "in_progress" },
                },
                { type: "response.output_text.delta", item_id: "msg_partial", delta: "The next step is" },
                {
                  type: "response.output_item.done",
                  item: {
                    type: "message",
                    id: "msg_partial",
                    status: "incomplete",
                    content: [{ type: "output_text", text: "The next step is" }],
                  },
                },
                {
                  type: "response.incomplete",
                  response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
                },
              ),
            ),
          ),
        )
        expect(response.finishReason.normalized).toBe("length")
        expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
        const prepared = yield* compileRequest(
          ai.request({ model, messages: [response.message, Message.user("Continue")] }),
        )
        expect(prepared.body.input).toEqual([
          {
            type: "message",
            role: "assistant",
            id: "msg_partial",
            status: "completed",
            content: [{ type: "output_text", text: "The next step is" }],
          },
          { type: "message", role: "user", content: [{ type: "input_text", text: "Continue" }] },
        ])
      }),
    )
  })
}

describe("Responses replay of commentary after a tool call in the same turn", () => {
  const settings = { apiKey: "test-key", baseURL: "https://responses.example.test/v1" }
  const call = (key: string, id: string, input: Record<string, unknown>) => ({
    type: "tool-call" as const,
    id,
    name: "execute",
    input,
    providerMetadata: { [key]: { itemId: `fc_${id}` } },
  })
  const commentary = (key: string, id: string, text: string) => ({
    type: "text" as const,
    text,
    providerMetadata: { [key]: { itemId: id, phase: "commentary" } },
  })

  for (const [model, keepsPhase] of [
    [Meta.model("muse-ember-1.0", { apiKey: "test-key" }), false],
    [OpenAI.model("muse-ember-1.0", { apiKey: "test-key" }), false],
    [compatible("meta/muse-spark-1.3", settings), false],
    [OpenAI.model("gpt-6.1", { apiKey: "test-key" }), true],
    [compatible("example-model", settings), true],
  ] as const) {
    it.effect(`${keepsPhase ? "keeps" : "drops"} the phase for ${model.api.protocol.id} ${model.id}`, () =>
      Effect.gen(function* () {
        const key = model.metadataKey
        const prepared = yield* compileRequest(
          ai.request({
            model,
            messages: [
              Message.user("Check the fillet"),
              Message.make({
                role: "assistant",
                content: [
                  commentary(key, "msg_before", "Reading the schematic."),
                  call(key, "call_a", {}),
                  commentary(key, "msg_after", "Checking the fillet."),
                  call(key, "call_b", { code: "1" }),
                ],
              }),
              Message.make({
                role: "tool",
                content: [
                  { type: "tool-result", id: "call_a", name: "execute", result: { type: "error", value: "Bad input" } },
                  { type: "tool-result", id: "call_b", name: "execute", result: { type: "text", value: "1" } },
                ],
              }),
            ],
          }),
        )
        expect(prepared.body.input.slice(1)).toEqual([
          {
            type: "message",
            role: "assistant",
            id: "msg_before",
            phase: "commentary",
            status: "completed",
            content: [{ type: "output_text", text: "Reading the schematic." }],
          },
          { type: "function_call", id: "fc_call_a", call_id: "call_a", name: "execute", arguments: "{}" },
          {
            type: "message",
            role: "assistant",
            id: "msg_after",
            ...(keepsPhase ? { phase: "commentary" } : {}),
            status: "completed",
            content: [{ type: "output_text", text: "Checking the fillet." }],
          },
          { type: "function_call", id: "fc_call_b", call_id: "call_b", name: "execute", arguments: '{"code":"1"}' },
          { type: "function_call_output", call_id: "call_a", output: "Bad input" },
          { type: "function_call_output", call_id: "call_b", output: "1" },
        ])
      }),
    )
  }
})
