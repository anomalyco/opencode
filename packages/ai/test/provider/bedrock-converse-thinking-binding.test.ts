import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { GenerationOptions, LanguageModel, LLM } from "../../src/index.js"
import { compileRequest } from "../../src/route/client.js"
import { AmazonBedrock } from "../../src/providers.js"
import { it } from "../lib/effect.js"

const binding = { prefix_mismatch_behavior: "drop_block" }
const beta = ["thinking-binding-controls-2026-08-01"]

const bedrock = (id: string, settings: Parameters<typeof AmazonBedrock.model>[1] = {}) =>
  AmazonBedrock.model(id, { baseURL: "https://bedrock-runtime.test", apiKey: "test-bearer", ...settings })

const fields = (model: LanguageModel, generation?: GenerationOptions) =>
  compileRequest(
    LLM.request({ id: "req_1", model, system: "You are concise.", prompt: "Say hello.", cache: "none", generation }),
  ).pipe(Effect.map((prepared) => prepared.body.additionalModelRequestFields))

describe("Bedrock Converse thinking block binding", () => {
  for (const id of [
    "global.anthropic.claude-fable-5-1",
    "us.anthropic.claude-fable-5-1-v1:0",
    "anthropic.claude-fable-5.1",
    "anthropic.claude-mythos-5-1",
    "us.anthropic.claude-opus-5-5",
    "global.anthropic.claude-sonnet-5-5",
    "anthropic.claude-opus-6",
  ]) {
    it.effect(`defaults adaptive thinking to drop_block with the beta for ${id}`, () =>
      Effect.gen(function* () {
        expect(yield* fields(bedrock(id))).toEqual({
          thinking: { type: "adaptive", block_binding: binding },
          anthropic_beta: beta,
        })
      }),
    )
  }

  for (const id of [
    "global.anthropic.claude-opus-5",
    "us.anthropic.claude-sonnet-5",
    "global.anthropic.claude-fable-5",
    "anthropic.claude-fable-5-v1:0",
    "global.anthropic.claude-opus-4-8",
    "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "us.amazon.nova-2-lite-v1:0",
  ]) {
    it.effect(`leaves ${id} untouched`, () =>
      Effect.gen(function* () {
        expect(yield* fields(bedrock(id))).toBeUndefined()
      }),
    )
  }

  it.effect("binds a manual thinking budget and keeps top_k", () =>
    Effect.gen(function* () {
      expect(
        yield* fields(
          bedrock("global.anthropic.claude-fable-5-1", { thinking: { type: "enabled", budgetTokens: 4_000 } }),
          GenerationOptions.make({ maxTokens: 64_000, topK: 40 }),
        ),
      ).toEqual({
        top_k: 40,
        thinking: { type: "enabled", budget_tokens: 4_000, block_binding: binding },
        anthropic_beta: beta,
      })
    }),
  )

  it.effect("does not bind disabled thinking", () =>
    Effect.gen(function* () {
      expect(
        yield* fields(
          bedrock("global.anthropic.claude-fable-5-1", {
            body: { additionalModelRequestFields: { thinking: { type: "disabled" } } },
          }),
        ),
      ).toBeUndefined()
    }),
  )

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const arn = "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123"
      expect(yield* fields(bedrock(arn))).toBeUndefined()
      expect(
        yield* fields(LanguageModel.update(bedrock(arn), { compatibility: { supportsThinkingBlockBinding: true } })),
      ).toEqual({ thinking: { type: "adaptive", block_binding: binding }, anthropic_beta: beta })
      expect(
        yield* fields(
          LanguageModel.update(bedrock("global.anthropic.claude-fable-5-1"), {
            compatibility: { supportsThinkingBlockBinding: false },
          }),
        ),
      ).toBeUndefined()
    }),
  )
})
