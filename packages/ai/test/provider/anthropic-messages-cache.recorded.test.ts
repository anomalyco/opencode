import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, LLMRequest, Message, ToolCallPart, ToolDefinition } from "../../src"
import { LLMClient } from "../../src/route"
import * as Anthropic from "../../src/providers/anthropic"
import { LARGE_CACHEABLE_SYSTEM } from "../recorded-scenarios"
import { recordedTests } from "../recorded-test"

const model = Anthropic.configure({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture",
}).model("claude-haiku-4-5-20251001")

// Two identical generations in a row. The first call writes the prefix into
// Anthropic's cache; the second should report a cache read against the same
// prefix. Cassette captures both interactions in order.
const cacheRequest = LLM.request({
  id: "recorded_anthropic_cache",
  model,
  system: [{ type: "text", text: LARGE_CACHEABLE_SYSTEM, cache: new CacheHint({ type: "ephemeral" }) }],
  prompt: "Say hi.",
  // Manual hint on the system part is the only marker we want here — skip the
  // auto-policy's latest-user-message breakpoint so the cassette body matches.
  cache: "none",
  generation: { maxTokens: 16, temperature: 0 },
})

const lookup = ToolDefinition.make({
  name: "lookup",
  description: "Look up a fixture value.",
  inputSchema: {
    type: "object",
    properties: { index: { type: "number" } },
    required: ["index"],
    additionalProperties: false,
  },
})
const longToolTurn = [
  Message.user("Run the fixture lookups."),
  ...Array.from({ length: 11 }, (_, index) => {
    const id = `lookup_${index}`
    return [
      Message.assistant(ToolCallPart.make({ id, name: lookup.name, input: { index } })),
      Message.tool({
        id,
        name: lookup.name,
        result: `Fixture result ${index}. `.repeat(80),
      }),
    ]
  }).flat(),
]
const longToolTurnRequest = LLM.request({
  id: "recorded_anthropic_cache_long_tool_turn",
  model,
  system: LARGE_CACHEABLE_SYSTEM,
  messages: longToolTurn,
  tools: [lookup],
  generation: { maxTokens: 16, temperature: 0 },
})

const recorded = recordedTests({
  prefix: "anthropic-messages-cache",
  provider: "anthropic",
  protocol: "anthropic-messages",
  requires: ["ANTHROPIC_API_KEY"],
  // Two identical requests in one cassette — replay walks the cassette in
  // recording order so the second call replays the cached-hit interaction.
  options: {
    redact: { allowRequestHeaders: ["anthropic-version"] },
  },
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

  recorded.effect.with("keeps a long tool turn inside the cache lookback", { tags: ["cache", "tool"] }, () =>
    Effect.gen(function* () {
      const first = yield* LLMClient.generate(longToolTurnRequest)
      const firstRead = first.usage?.cacheReadInputTokens ?? 0
      const firstWrite = first.usage?.cacheWriteInputTokens ?? 0
      const firstCached = firstRead + firstWrite
      // The prefix may already be warm when recording, so either a read or a
      // write establishes that Anthropic recognized the cache boundary.
      expect(firstCached).toBeGreaterThan(0)

      const second = yield* LLMClient.generate(
        LLMRequest.update(longToolTurnRequest, {
          messages: [
            ...longToolTurn,
            Message.assistant("The fixture lookups are complete."),
            Message.user("Reply exactly: OK"),
          ],
        }),
      )
      expect(second.usage?.cacheReadInputTokens ?? 0).toBeGreaterThanOrEqual(firstCached)
      expect(second.usage?.cacheWriteInputTokens ?? 0).toBeLessThan(firstCached)
    }),
  )
})
