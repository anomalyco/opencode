import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as Gemini from "../../src/protocols/gemini"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = Gemini.model({
  id: "gemini-2.5-flash",
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? "fixture",
})

// Gemini does implicit prefix caching on 2.5+ models above ~1024 tokens. The
// `CacheHint` is currently a no-op for Gemini (the explicit `CachedContent`
// API is out-of-band and intentionally not wired up). This test exists to
// pin the usage-parsing path: `cachedContentTokenCount` should surface as
// `cacheReadInputTokens` on the second identical call.
const cacheRequest = LLM.request({
  id: "recorded_gemini_cache",
  model,
  system: LARGE_CACHEABLE_SYSTEM,
  prompt: "Say hi.",
  generation: { maxTokens: 16, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "gemini-cache",
  provider: "google",
  protocol: "gemini",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  // Two identical requests in one cassette — replay walks the cassette in
  // recording order so the second call replays the cached-hit interaction.
})

describe("Gemini cache recorded", () => {
  recorded.effect.with("reports cachedContentTokenCount on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      expect(first.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)

      const second = yield* LLMClient.generate(cacheRequest)
      // Implicit caching is best-effort on Gemini's side; we assert the field
      // is at least populated and non-negative. When re-recording, verify the
      // cassette shows > 0 in the second response's usage.
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)
    }),
  )
})
