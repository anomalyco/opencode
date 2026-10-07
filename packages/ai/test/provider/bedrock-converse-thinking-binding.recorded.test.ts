import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { AmazonBedrock } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const RECORDING_REGION = process.env.BEDROCK_RECORDING_REGION ?? "us-east-1"

// Claude Opus 5.5 enforces the conversation-prefix check on Bedrock, so a changed system prompt is a real
// mismatch. Override with BEDROCK_BINDING_MODEL_ID for another model that enforces it.
const modelID = process.env.BEDROCK_BINDING_MODEL_ID ?? "global.anthropic.claude-opus-5-5"

// Mirrors the "high" variant, so the recording covers the real overlay and default merge.
const model = (blockBinding?: { readonly prefix_mismatch_behavior: string }) =>
  AmazonBedrock.model(modelID, {
    apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
    region: RECORDING_REGION,
    body: {
      additionalModelRequestFields: {
        thinking: { type: "adaptive", display: "summarized", ...(blockBinding ? { block_binding: blockBinding } : {}) },
        output_config: { effort: "high" },
      },
    },
  })

const question = "How many positive integers below 5000 have exactly 12 positive divisors? Reply with the number only."

const first = LLM.request({
  id: "recorded_bedrock_thinking_binding_first",
  model: model(),
  system: "You are a concise assistant.",
  prompt: question,
  cache: "none",
  generation: { maxTokens: 12_000 },
})

const recorded = recordedTests({
  prefix: "bedrock-converse-thinking-binding",
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
})

describe("Bedrock Converse thinking binding recorded", () => {
  recorded.effect.with("accepts the default binding with no thinking configured", { tags: ["reasoning"] }, () =>
    Effect.gen(function* () {
      const response = yield* LLMClient.generate(
        LLM.request({
          id: "recorded_bedrock_thinking_binding_default",
          model: AmazonBedrock.model(modelID, {
            apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
            region: RECORDING_REGION,
          }),
          system: "Reply with the single word 'Hello'.",
          prompt: "Say hello.",
          cache: "none",
          generation: { maxTokens: 1_024 },
        }),
      )

      expect(response.finishReason?.normalized).toBe("stop")
      expect(response.text).toMatch(/hello/i)
    }),
  )

  recorded.effect.with(
    "keeps a session working after the system prompt changes",
    { tags: ["reasoning"] },
    () =>
      Effect.gen(function* () {
        const turn = yield* LLMClient.generate(first)
        // The signed thinking block is what Bedrock binds to the first system prompt.
        expect(turn.message.content.some((part) => part.type === "reasoning")).toBe(true)

        // Replay the assistant turn under a different system prompt, as a prompt rebuild or compaction would.
        const next = LLMRequest.update(first, {
          id: "recorded_bedrock_thinking_binding_next",
          system: [{ type: "text", text: "You are a concise assistant. Today is Monday." }],
          messages: [
            ...first.messages,
            Message.assistant(turn.message.content),
            Message.user("Now double it. Reply with the number only."),
          ],
        })

        const bound = yield* LLMClient.generate(next)
        expect(bound.finishReason?.normalized).toBe("stop")
        expect(bound.text).toMatch(/\d/)

        // The same replay is rejected when the caller asks for the default `error` behavior, proving the check is
        // enforced and that the default `drop_block` is what let the request above through.
        const rejected = yield* LLMClient.generate(
          LLMRequest.update(next, {
            id: "recorded_bedrock_thinking_binding_error",
            model: model({ prefix_mismatch_behavior: "error" }),
          }),
        ).pipe(Effect.flip)
        expect(rejected.message).toContain("bound to a different conversation")
      }),
    60_000,
  )
})
