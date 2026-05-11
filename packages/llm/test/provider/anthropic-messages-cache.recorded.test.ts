import { Redactor } from "@opencode-ai/http-recorder"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM } from "../../src"
import { LLMClient } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = AnthropicMessages.model({
  id: "claude-haiku-4-5-20251001",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
})

// Two identical generations in a row. The first call writes the prefix into
// Anthropic's cache; the second should report a cache read against the same
// prefix. Cassette captures both interactions in order.
const cacheRequest = LLM.request({
  id: "recorded_anthropic_cache",
  model,
  system: [{ type: "text", text: LARGE_CACHEABLE_SYSTEM, cache: new CacheHint({ type: "ephemeral" }) }],
  prompt: "Say hi.",
  generation: { maxTokens: 16, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "anthropic-messages-cache",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  options: { redactor: Redactor.defaults({ requestHeaders: { allow: ["content-type", "anthropic-version"] } }) },
})

describe("Anthropic Messages cache recorded", () => {
  recorded.effect.with("writes then reads cache_control on identical second call", { tags: ["cache"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(cacheRequest)
      // The first call may write the cache (cacheWriteInputTokens > 0) or it
      // may be a fresh miss (both fields 0) depending on whether the prefix is
      // already warm on Anthropic's side. The assertion that matters is that
      // the SECOND call reports a non-zero cache read.
      expect(first.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(0)

      const second = yield* LLMClient.generate(cacheRequest)
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThan(0)
    }),
  )
})
