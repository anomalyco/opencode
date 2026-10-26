import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src/effect.js"
import { LLMClient } from "../../src/route.js"
import { AmazonBedrock } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const RECORDING_REGION = process.env.BEDROCK_RECORDING_REGION ?? "us-east-1"

const bedrock = (id: string, settings: Omit<Parameters<typeof AmazonBedrock.model>[1], "apiKey" | "region">) =>
  AmazonBedrock.model(id, {
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
    region: RECORDING_REGION,
    ...settings,
  })

const recorded = recordedTests({
  prefix: "bedrock-converse-options",
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
})

describe("Bedrock Converse options recorded", () => {
  // Claude on Bedrock only accepts the default tier; other tiers fail with "not supported for this model".
  recorded.effect.with(
    "sends Claude effort with adaptive thinking, service tier and request metadata",
    { tags: ["reasoning"] },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          LLM.request({
            id: "recorded_bedrock_options_claude",
            model: bedrock("us.anthropic.claude-sonnet-4-6", {
              effort: "high",
              thinking: { type: "adaptive", display: "summarized" },
              serviceTier: "default",
              requestMetadata: { suite: "opencode-ai" },
            }),
            prompt: "How many primes are below 60? Reply with the number only.",
            cache: "none",
            generation: { maxTokens: 4_000 },
          }),
        )

        expect(response.finishReason?.normalized).toBe("stop")
        expect(response.reasoning.length).toBeGreaterThan(0)
        expect(response.text).toContain("17")
      }),
  )

  recorded.effect.with("sends gpt-oss reasoning effort with the priority tier", { tags: ["reasoning"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_bedrock_options_gpt_oss",
          model: bedrock("openai.gpt-oss-120b-1:0", {
            effort: "low",
            serviceTier: "priority",
            requestMetadata: { suite: "opencode-ai" },
          }),
          prompt: "What is 17*23? Reply with the number only.",
          cache: "none",
          generation: { maxTokens: 1_000 },
        }),
      )

      expect(response.finishReason?.normalized).toBe("stop")
      expect(response.reasoning.length).toBeGreaterThan(0)
      expect(response.text).toContain("391")
    }),
  )

  recorded.effect.with("sends Nova 2 reasoning effort", { tags: ["reasoning"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_bedrock_options_nova",
          model: bedrock("us.amazon.nova-2-lite-v1:0", { effort: "low" }),
          prompt: "What is 17*23? Reply with the number only.",
          cache: "none",
          generation: { maxTokens: 1_000 },
        }),
      )

      expect(response.finishReason?.normalized).toBe("stop")
      expect(response.reasoning.length).toBeGreaterThan(0)
      expect(response.text).toContain("391")
    }),
  )

  recorded.effect("constrains Claude output to a JSON schema", () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_bedrock_options_output_format",
          model: bedrock("us.anthropic.claude-sonnet-4-6", {
            outputFormat: {
              type: "json_schema",
              name: "answer",
              schema: {
                type: "object",
                properties: { product: { type: "integer" } },
                required: ["product"],
                additionalProperties: false,
              },
            },
          }),
          prompt: "What is 17*23?",
          cache: "none",
          generation: { maxTokens: 200 },
        }),
      )

      expect(response.finishReason?.normalized).toBe("stop")
      expect(JSON.parse(response.text)).toEqual({ product: 391 })
    }),
  )
})
