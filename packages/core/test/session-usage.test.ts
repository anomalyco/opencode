import { expect, test } from "bun:test"
import { Usage } from "@opencode/ai/effect"
import { Money } from "@opencode/schema/money"
import { SessionUsage } from "@opencode/core/session/usage"

// $1 per million fresh input tokens, so a million of them price at $1 from the catalog.
const costs = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  },
]

test("prices the tokens from the catalog when the endpoint reports no cost", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000 }), costs).cost).toBe(Money.USD.make(1))
})

test("records the cost the endpoint reports instead of the catalog price", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0.25 }), costs).cost).toBe(
    Money.USD.make(0.25),
  )
})

test("keeps a reported zero cost, as for a request a subscription covered", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0 }), costs)).toEqual({
    tokens: { input: 1_000_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: Money.USD.zero,
  })
})

// GitHub Copilot's Claude Haiku 5.5 rate card: a per-request tier above 100K prompt tokens at 5x.
const haiku = [
  {
    input: Money.USDPerMillionTokens.make(0.1),
    output: Money.USDPerMillionTokens.make(0.5),
    cache: { read: Money.USDPerMillionTokens.make(0.01), write: Money.USDPerMillionTokens.make(0.125) },
  },
  {
    tier: { type: "context" as const, size: 100_000 },
    input: Money.USDPerMillionTokens.make(0.5),
    output: Money.USDPerMillionTokens.make(2.5),
    cache: { read: Money.USDPerMillionTokens.make(0.05), write: Money.USDPerMillionTokens.make(0.625) },
  },
]

test("applies the long-context tier when the prompt exceeds the tier boundary", () => {
  const usage = { input: 0, output: 200, reasoning: 0, cache: { read: 149_700, write: 300 } }
  // 149,700 reads at $0.05 + 300 writes at $0.625 + 200 output at $2.50, all long-context rates.
  expect(SessionUsage.calculateCost(haiku, usage)).toBeCloseTo(0.0081725, 12)
})

test("keeps the default tier at exactly the boundary", () => {
  const usage = { input: 0, output: 200, reasoning: 0, cache: { read: 100_000, write: 0 } }
  // The rate card bills "≤ 100K" prompts at the default tier.
  expect(SessionUsage.calculateCost(haiku, usage)).toBeCloseTo(0.0011, 12)
})

test("prices cache writes at the catalog rate", () => {
  const usage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 90_000 } }
  expect(SessionUsage.calculateCost(haiku, usage)).toBeCloseTo(0.01125, 12)
})

test("counts reasoning tokens as output", () => {
  const usage = { input: 0, output: 0, reasoning: 200, cache: { read: 149_700, write: 300 } }
  expect(SessionUsage.calculateCost(haiku, usage)).toBeCloseTo(0.0081725, 12)
})
