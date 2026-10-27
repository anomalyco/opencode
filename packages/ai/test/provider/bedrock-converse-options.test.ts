import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src/effect.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { AmazonBedrock } from "../../src/providers.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"

const bedrock = (id: string, settings: Omit<Parameters<typeof AmazonBedrock.model>[1], "apiKey" | "baseURL">) =>
  AmazonBedrock.model(id, { baseURL: "https://bedrock-runtime.test", apiKey: "test-bearer", ...settings })

const request = (model: ReturnType<typeof bedrock>) =>
  LLM.request({ model, prompt: "Say hello.", cache: "none", generation: { maxTokens: 64 } })

const body = (model: ReturnType<typeof bedrock>) =>
  compileRequest(request(model)).pipe(Effect.map((prepared) => prepared.body))

const fields = (model: ReturnType<typeof bedrock>) =>
  body(model).pipe(Effect.map((prepared) => prepared.additionalModelRequestFields))

const binding = { prefix_mismatch_behavior: "drop_block" }
const beta = ["thinking-binding-controls-2026-08-01"]

describe("Bedrock Converse options", () => {
  it.effect("maps effort to each model family's field", () =>
    Effect.gen(function* () {
      expect(yield* fields(bedrock("us.anthropic.claude-sonnet-4-6", { effort: "high" }))).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      })
      expect(yield* fields(bedrock("global.anthropic.claude-opus-5-5", { effort: "high" }))).toEqual({
        thinking: { type: "adaptive", block_binding: binding },
        output_config: { effort: "high" },
        anthropic_beta: beta,
      })
      expect(yield* fields(bedrock("openai.gpt-oss-120b-1:0", { effort: "low" }))).toEqual({ reasoning_effort: "low" })
      expect(yield* fields(bedrock("openai.gpt-5.6", { effort: "low" }))).toEqual({ reasoning: { effort: "low" } })
      expect(yield* fields(bedrock("us.xai.grok-4.6", { effort: "low" }))).toEqual({ reasoning: { effort: "low" } })
      expect(yield* fields(bedrock("us.amazon.nova-2-lite-v1:0", { effort: "medium" }))).toEqual({
        reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" },
      })
    }),
  )

  for (const id of ["us.anthropic.claude-opus-4-5-20251101-v1:0", "us.anthropic.claude-3-7-sonnet-20250219-v1:0"])
    it.effect(`keeps ${id} effort beside its manual thinking budget`, () =>
      Effect.gen(function* () {
        expect(yield* fields(bedrock(id, { effort: "high" }))).toEqual({ output_config: { effort: "high" } })
        expect(
          yield* fields(bedrock(id, { effort: "high", thinking: { type: "enabled", budgetTokens: 1_024 } })),
        ).toEqual({ thinking: { type: "enabled", budget_tokens: 1_024 }, output_config: { effort: "high" } })
      }),
    )

  it.effect("sends explicit adaptive and disabled Claude thinking", () =>
    Effect.gen(function* () {
      expect(
        yield* fields(
          bedrock("us.anthropic.claude-sonnet-4-6", {
            effort: "low",
            thinking: { type: "adaptive", display: "summarized" },
          }),
        ),
      ).toEqual({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low" } })
      expect(yield* fields(bedrock("global.anthropic.claude-opus-5-5", { thinking: { type: "disabled" } }))).toEqual({
        thinking: { type: "disabled" },
      })
    }),
  )

  it.effect("omits maxTokens for Nova 2 at high effort", () =>
    Effect.gen(function* () {
      expect((yield* body(bedrock("us.amazon.nova-2-lite-v1:0", { effort: "high" }))).inferenceConfig).toBeUndefined()
    }),
  )

  it.effect("sends service tier, guardrail, structured output and request metadata", () =>
    Effect.gen(function* () {
      const prepared = yield* body(
        bedrock("us.anthropic.claude-sonnet-4-6", {
          serviceTier: "priority",
          guardrail: { identifier: "abc123", version: "1", trace: "enabled", streamProcessingMode: "async" },
          outputFormat: {
            type: "json_schema",
            name: "answer",
            schema: { type: "object", properties: { product: { type: "integer" } } },
          },
          requestMetadata: { suite: "opencode-ai" },
        }),
      )

      expect(prepared).toEqual({
        modelId: "us.anthropic.claude-sonnet-4-6",
        messages: [{ role: "user", content: [{ text: "Say hello." }] }],
        inferenceConfig: { maxTokens: 64 },
        serviceTier: { type: "priority" },
        guardrailConfig: {
          guardrailIdentifier: "abc123",
          guardrailVersion: "1",
          trace: "enabled",
          streamProcessingMode: "async",
        },
        outputConfig: {
          textFormat: {
            type: "json_schema",
            structure: {
              jsonSchema: {
                name: "answer",
                schema: '{"type":"object","properties":{"product":{"type":"integer"}}}',
              },
            },
          },
        },
        requestMetadata: { suite: "opencode-ai" },
      })
    }),
  )

  it.effect("lets http.body override typed options field by field", () =>
    Effect.gen(function* () {
      const sent: string[] = []
      yield* LLMClient.generate(
        request(
          bedrock("us.anthropic.claude-sonnet-4-6", {
            effort: "low",
            serviceTier: "priority",
            body: { additionalModelRequestFields: { output_config: { effort: "max" } }, serviceTier: { type: "flex" } },
          }),
        ),
      ).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              sent.push(input.text)
              return input.respond("{}", { status: 400 })
            }),
          ),
        ),
        Effect.ignore,
      )

      expect(JSON.parse(sent[0]!)).toMatchObject({
        additionalModelRequestFields: { thinking: { type: "adaptive" }, output_config: { effort: "max" } },
        serviceTier: { type: "flex" },
      })
    }),
  )
})
