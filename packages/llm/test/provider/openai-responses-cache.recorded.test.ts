import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenAIResponses from "../../src/protocols/openai-responses"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = OpenAIResponses.model({
  id: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
})

// OpenAI caches prefixes automatically once they cross the 1024-token threshold;
// `CacheHint` is a no-op for the wire body. The stable signal is the
// `prompt_cache_key` routing hint, which keeps repeated calls on the same shard
// so cache hits are observable.
const cacheRequest = LLM.request({
  id: "recorded_openai_responses_cache",
  model,
  system: LARGE_CACHEABLE_SYSTEM,
  prompt: "Say hi.",
  generation: { maxTokens: 16, temperature: 0 },
  providerOptions: { openai: { promptCacheKey: "recorded-cache-test" } },
})

const recorded = recordedTests({
  prefix: "openai-responses-cache",
  provider: "openai",
  protocol: "openai-responses",
  requires: ["OPENAI_API_KEY"],
  // Two identical requests in one cassette — match by recording order so the
  // second call replays the cached-hit interaction, not the cold-miss one.
  options: { dispatch: "sequential" },
})

describe("OpenAI Responses cache recorded", () => {
  recorded.effect.with("reports cached_tokens on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      expect(first.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)

      const second = yield* LLMClient.generate(cacheRequest)
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThan(0)
    }),
  )
})
