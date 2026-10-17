import { expect, test } from "bun:test"
import { Usage } from "@opencode/ai"
import { Money } from "@opencode/schema/money"
import { SessionUsage } from "@opencode/core/session/usage"

// $1 per million fresh input tokens, $2 per million output tokens, cache free.
const costs = [
  {
    input: Money.USDPerMillionTokens.make(1),
    output: Money.USDPerMillionTokens.make(2),
    cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
  },
]

const priced = Money.USD.make(1) // 1M fresh input tokens at $1/M

test("prefers a provider-reported cost over catalog pricing", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0.25 }), costs).cost).toBe(
    Money.USD.make(0.25),
  )
  // A reported zero is authoritative (flat-fee or free routed request), not "missing".
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: 0 }), costs).cost).toBe(Money.USD.zero)
})

test("falls back to catalog pricing when the reported cost is absent or unusable", () => {
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000 }), costs).cost).toBe(priced)
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: Number.NaN }), costs).cost).toBe(priced)
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: -1 }), costs).cost).toBe(priced)
  expect(SessionUsage.record(new Usage({ nonCachedInputTokens: 1_000_000, cost: Number.POSITIVE_INFINITY }), costs).cost).toBe(priced)
})
