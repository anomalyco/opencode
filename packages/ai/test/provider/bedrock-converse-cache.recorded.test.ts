import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { AmazonBedrock } from "../../src/providers.js"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios.js"
import { recordedTests } from "../recorded-test.js"

const RECORDING_REGION = process.env.BEDROCK_RECORDING_REGION ?? "us-east-1"

// Use a Claude model on Bedrock — Nova has automatic prefix caching that
// doesn't reliably surface `cacheRead`/`cacheWrite` in usage, so the second
// call wouldn't deterministically prove cache mapping works. Override with
// BEDROCK_CACHE_MODEL_ID if your account has access elsewhere.
const model = AmazonBedrock.configure({
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK ?? "fixture",
  region: RECORDING_REGION,
}).model(process.env.BEDROCK_CACHE_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0")

const cacheRequest = LLM.request({
  id: "recorded_bedrock_cache",
  model,
  system: [{ type: "text", text: LARGE_CACHEABLE_SYSTEM, cache: new CacheHint({ type: "ephemeral" }) }],
  prompt: "Say hi.",
  // Manual hint on the system part is the only marker we want here — skip the
  // auto-policy's latest-user-message breakpoint so the cassette body matches.
  cache: "none",
  generation: { maxTokens: 16, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "bedrock-converse-cache",
  provider: "amazon-bedrock",
  protocol: "bedrock-converse",
  requires: ["AWS_BEARER_TOKEN_BEDROCK"],
  // Two identical requests in one cassette — replay walks the cassette in
  // recording order so the second call replays the cached-hit interaction.
})

describe("Bedrock Converse cache recorded", () => {
  recorded.effect.with("writes then reads cachePoint on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      expect(first.usage?.cacheWriteInputTokens ?? 0).toBeGreaterThan(0)
      expect(first.usage?.inputTokens).toBe(
        (first.usage?.nonCachedInputTokens ?? 0) +
          (first.usage?.cacheReadInputTokens ?? 0) +
          (first.usage?.cacheWriteInputTokens ?? 0),
      )

      const second = yield* LLMClient.generate(cacheRequest)
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThan(0)
      expect(second.usage?.inputTokens).toBe(
        (second.usage?.nonCachedInputTokens ?? 0) +
          (second.usage?.cacheReadInputTokens ?? 0) +
          (second.usage?.cacheWriteInputTokens ?? 0),
      )
    }),
  )
})
