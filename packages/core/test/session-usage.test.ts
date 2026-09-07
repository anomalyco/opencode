import { expect, test } from "bun:test"
import { Usage } from "@opencode-ai/ai"
import { SessionUsage } from "@opencode-ai/core/session/usage"
import { Money } from "@opencode-ai/schema/money"

const costs = [
  {
    input: Money.USDPerMillionTokens.make(3),
    output: Money.USDPerMillionTokens.make(15),
    cache: {
      read: Money.USDPerMillionTokens.make(0.3),
      write: Money.USDPerMillionTokens.make(3.75),
    },
  },
]

test.each([
  { name: "missing breakdown", creation: undefined, cost: 0.0375 },
  { name: "5-minute writes", creation: { ephemeral_1h_input_tokens: 0 }, cost: 0.0375 },
  {
    name: "mixed TTL writes",
    creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 8_000 },
    cost: 0.0555,
  },
  { name: "1-hour writes", creation: { ephemeral_1h_input_tokens: 10_000 }, cost: 0.06 },
  { name: "null breakdown", creation: null, cost: 0.0375 },
  { name: "malformed breakdown", creation: { ephemeral_1h_input_tokens: "8000" }, cost: 0.0375 },
  { name: "negative subset", creation: { ephemeral_1h_input_tokens: -1 }, cost: 0.0375 },
  { name: "oversized subset", creation: { ephemeral_1h_input_tokens: 20_000 }, cost: 0.06 },
])("prices Anthropic cache creation: $name", ({ creation, cost }) => {
  const recorded = SessionUsage.record(
    new Usage({
      cacheWriteInputTokens: 10_000,
      providerMetadata: { anthropic: { cache_creation: creation } },
    }),
    costs,
  )
  expect(recorded.cost).toBeCloseTo(cost, 10)
  expect(recorded.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 10_000 } })
})

test("prices 1-hour writes with the selected context tier without double-counting its subset", () => {
  const recorded = SessionUsage.record(
    new Usage({
      nonCachedInputTokens: 1,
      cacheWriteInputTokens: 10_000,
      providerMetadata: { anthropic: { cache_creation: { ephemeral_1h_input_tokens: 8_000 } } },
    }),
    [
      ...costs,
      {
        tier: { type: "context", size: 10_000 },
        input: Money.USDPerMillionTokens.make(6),
        output: Money.USDPerMillionTokens.make(30),
        cache: { read: Money.USDPerMillionTokens.make(0.6), write: Money.USDPerMillionTokens.make(7.5) },
      },
      ...costs.map((cost) => ({ ...cost, tier: { type: "context" as const, size: 15_000 } })),
    ],
  )
  expect(recorded.cost).toBeCloseTo(0.111006, 10)
  expect(recorded.tokens.cache.write).toBe(10_000)
})

test("does not apply Anthropic pricing to another provider's metadata", () => {
  expect(
    SessionUsage.record(
      new Usage({
        cacheWriteInputTokens: 10_000,
        providerMetadata: { openai: { cache_creation: { ephemeral_1h_input_tokens: 8_000 } } },
      }),
      costs,
    ).cost,
  ).toBeCloseTo(0.0375, 10)
})

test.each([0, 2])("respects a configured cache-write price of %s for 1-hour writes", (write) => {
  expect(
    SessionUsage.record(
      new Usage({
        cacheWriteInputTokens: 10_000,
        providerMetadata: { anthropic: { cache_creation: { ephemeral_1h_input_tokens: 8_000 } } },
      }),
      costs.map((cost) => ({ ...cost, cache: { ...cost.cache, write: Money.USDPerMillionTokens.make(write) } })),
    ).cost,
  ).toBeCloseTo((2_000 * write + 8_000 * write * 1.6) / 1_000_000, 10)
})
