import { expect, test } from "bun:test"
import { Usage } from "@opencode-ai/ai"
import { Money } from "@opencode-ai/schema/money"
import { SessionUsage } from "@opencode-ai/core/session/usage"

const costs = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  },
]

test("prefers provider-reported cost", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0.25 }), costs).cost).toBe(
    Money.USD.make(0.25),
  )
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0 }), costs).cost).toBe(Money.USD.zero)
})

test("falls back to catalog pricing for invalid reported cost", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: Number.NaN }), costs).cost).toBe(
    Money.USD.make(1),
  )
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: -1 }), costs).cost).toBe(
    Money.USD.make(1),
  )
})
