import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LanguageModel, LLM } from "../../src/index.js"
import { AmazonBedrock } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const provider = AmazonBedrock.configure({ apiKey: "test-bearer", region: "us-east-1" })
const beta = "thinking-binding-controls-2026-08-01"

const wire = Effect.fn(function* (request: ReturnType<typeof LLM.request>) {
  const compiled = yield* compileRequest(request)
  const prepared = yield* request.model.route.prepareTransport(compiled.body, request)
  expect(prepared.request.body._tag).toBe("Uint8Array")
  if (prepared.request.body._tag !== "Uint8Array") throw new Error("Expected JSON request body")
  return yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(
    new TextDecoder().decode(prepared.request.body.body),
  ).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Struct({ additionalModelRequestFields: Schema.optional(Schema.Unknown) })),
    ),
  )
})

for (const [id, enabled] of [
  ["global.anthropic.claude-opus-5-5", true],
  ["us.anthropic.claude-fable-5-1-v1:0", true],
  ["anthropic.claude-sonnet-6", true],
  ["global.anthropic.claude-opus-5", false],
  ["anthropic.claude-sonnet-4-5-20250929-v1:0", false],
  ["amazon.nova-2-pro-v1:0", false],
] as const) {
  it.effect(`Bedrock thinking-binding defaults for ${id}`, () =>
    Effect.gen(function* () {
      const body = yield* wire(LLM.request({ model: provider.model(id), prompt: "Hello" }))
      expect(body.additionalModelRequestFields).toEqual(
        enabled
          ? {
              thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
              anthropic_beta: [beta],
            }
          : undefined,
      )
    }),
  )
}

it.effect("preserves Bedrock variant fields and existing betas when adding binding controls", () =>
  Effect.gen(function* () {
    const body = yield* wire(
      LLM.request({
        model: provider.model("global.anthropic.claude-opus-5-5"),
        prompt: "Hello",
        http: {
          body: {
            additionalModelRequestFields: {
              thinking: { type: "adaptive", display: "summarized" },
              output_config: { effort: "high" },
              anthropic_beta: ["existing-beta", beta],
            },
          },
        },
      }),
    )
    expect(body.additionalModelRequestFields).toEqual({
      thinking: {
        type: "adaptive",
        display: "summarized",
        block_binding: { prefix_mismatch_behavior: "drop_block" },
      },
      output_config: { effort: "high" },
      anthropic_beta: ["existing-beta", beta],
    })
  }),
)

it.effect("preserves an enabled thinking budget and explicit mismatch behavior", () =>
  Effect.gen(function* () {
    const body = yield* wire(
      LLM.request({
        model: provider.model("global.anthropic.claude-opus-5-5"),
        prompt: "Hello",
        generation: { maxTokens: 4096 },
        providerOptions: { thinking: { type: "enabled", budgetTokens: 2048 } },
        http: {
          body: {
            additionalModelRequestFields: { thinking: { block_binding: { prefix_mismatch_behavior: "error" } } },
          },
        },
      }),
    )
    expect(body.additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048, block_binding: { prefix_mismatch_behavior: "error" } },
      anthropic_beta: [beta],
    })
  }),
)

it.effect("respects disabled thinking and the model compatibility opt-out", () =>
  Effect.gen(function* () {
    const disabled = yield* wire(
      LLM.request({
        model: provider.model("global.anthropic.claude-opus-5-5"),
        prompt: "Hello",
        http: { body: { additionalModelRequestFields: { thinking: { type: "disabled" } } } },
      }),
    )
    expect(disabled.additionalModelRequestFields).toEqual({ thinking: { type: "disabled" } })
    const optedOut = yield* wire(
      LLM.request({
        model: LanguageModel.update(provider.model("global.anthropic.claude-opus-5-5"), {
          compatibility: { supportsThinkingBlockBinding: false },
        }),
        prompt: "Hello",
      }),
    )
    expect(optedOut.additionalModelRequestFields).toBeUndefined()
  }),
)
