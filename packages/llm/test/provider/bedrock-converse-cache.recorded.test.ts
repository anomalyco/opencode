import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as BedrockConverse from "../../src/protocols/bedrock-converse"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const RECORDING_REGION = process.env.BEDROCK_RECORDING_REGION ?? "us-east-1"

// Use a Claude model on Bedrock — Nova has automatic prefix caching that
// doesn't reliably surface `cacheRead`/`cacheWrite` in usage, so the second
// call wouldn't deterministically prove cache mapping works. Override with
// BEDROCK_CACHE_MODEL_ID if your account has access elsewhere.
const model = BedrockConverse.model({
  id: process.env.BEDROCK_CACHE_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  credentials: {
    region: RECORDING_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fixture",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fixture",
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
})

const cacheRequest = LLM.request({
  id: "recorded_bedrock_cache",
  model,
  system: [{ type: "text", text: LARGE_CACHEABLE_SYSTEM, cache: new CacheHint({ type: "ephemeral" }) }],
  prompt: "Say hi.",
  generation: { maxTokens: 16, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "bedrock-converse-cache",
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
})

describe("Bedrock Converse cache recorded", () => {
  recorded.effect.with("writes then reads cachePoint on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      expect(first.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)

      const second = yield* LLMClient.generate(cacheRequest)
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThan(0)
    }),
  )
})
