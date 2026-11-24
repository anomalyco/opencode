import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, LLMEvent, Message } from "../../src/effect.js"
import { OpenAI } from "../../src/providers.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { compileRequest, LLMClient } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

for (const model of [
  OpenAI.configure({ apiKey: "test-key" }).responses("example-model"),
  configure({ apiKey: "test-key", baseURL: "https://responses.example.test/v1" }).model("example-model"),
]) {
  describe(`${model.route.protocol} message replay`, () => {
    const key = model.route.providerMetadataKey ?? "openresponses"

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

// Copilot rejects replayed item ids and encrypted reasoning from another connection with
// `401 input item does not belong to this connection`; the default `store: false` keeps none of them useful.
describe("github-copilot responses replay", () => {
  const history = (model: ReturnType<typeof configure>["model"] extends (id: never) => infer M ? M : never) => {
    const key = model.route.providerMetadataKey ?? "openresponses"
    return ai.request({
      model,
      messages: [
        Message.user("Hi"),
        Message.make({
          role: "assistant",
          providerMetadata: { [key]: { itemId: "msg_old" } },
          content: [
            {
              type: "reasoning",
              text: "thinking",
              providerMetadata: { [key]: { itemId: "rs_old", reasoningEncryptedContent: "enc_old" } },
            },
            { type: "text", text: "Answer", providerMetadata: { [key]: { itemId: "msg_old" } } },
            {
              type: "tool-call",
              id: "call_1",
              name: "lookup",
              input: {},
              providerMetadata: { [key]: { itemId: "fc_old" } },
            },
          ],
        }),
        Message.tool({ id: "call_1", name: "lookup", result: "ok" }),
        Message.user("Continue"),
      ],
    })
  }
  const configured = (provider: string, store?: boolean) =>
    configure({
      baseURL: "https://copilot.example.test",
      apiKey: "test-key",
      provider,
      ...(store === undefined ? {} : { providerOptions: { store } }),
    }).model("gpt-example")

  it.effect("drops provider-scoped ids and encrypted reasoning when nothing is stored", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(history(configured("github-copilot")))
      const input = JSON.stringify(prepared.body.input)
      for (const scoped of ["msg_old", "rs_old", "fc_old", "enc_old", '"reasoning"'])
        expect(input).not.toContain(scoped)
      expect(input).toContain("Answer")
      expect(input).toContain("call_1")
    }),
  )

  it.effect("keeps ids for other providers and for stored Copilot history", () =>
    Effect.gen(function* () {
      for (const model of [configured("example"), configured("github-copilot", true)]) {
        const prepared = yield* compileRequest(history(model))
        expect(JSON.stringify(prepared.body.input)).toContain("rs_old")
        expect(JSON.stringify(prepared.body.input)).toContain("fc_old")
      }
    }),
  )
})
