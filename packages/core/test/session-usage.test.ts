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
