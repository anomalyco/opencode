import { describe, expect, test } from "bun:test"
import { calculateCost, Usage, type Cost } from "../src/schema/index.js"

const cost: Cost = {
  text: {
    input: {
      price: 2,
      cache: { read: 0.2, write: { "5m": 2.5, "1h": 4 } },
      overrides: [{ when: { context: { gt: 200_000 } }, price: 4, cache: { read: 0.4 } }],
    },
    output: { price: 10, overrides: [{ when: { context: { gt: 200_000 } }, price: 15 }] },
  },
}

const usage = (input: Partial<ConstructorParameters<typeof Usage>[0]>) => new Usage(input)

describe("calculateCost", () => {
  test("prices input, output with reasoning, cache reads and the first cache write TTL", () => {
    expect(
      calculateCost(
        cost,
        usage({
          nonCachedInputTokens: 1_000,
          outputTokens: 500,
          reasoningTokens: 200,
          cacheReadInputTokens: 10_000,
          cacheWriteInputTokens: 2_000,
        }),
      ),
    ).toBe((1_000 * 2 + 500 * 10 + 10_000 * 0.2 + 2_000 * 2.5) / 1_000_000)
  })

  test("uses the tier above its context size and keeps the prices it doesn't set", () => {
    expect(
      calculateCost(cost, usage({ nonCachedInputTokens: 150_000, cacheReadInputTokens: 60_000, outputTokens: 1_000 })),
    ).toBe((150_000 * 4 + 1_000 * 15 + 60_000 * 0.4) / 1_000_000)
    expect(calculateCost(cost, usage({ nonCachedInputTokens: 200_000 }))).toBe((200_000 * 2) / 1_000_000)
  })

  test("prices nothing it can't price per token", () => {
    expect(calculateCost(undefined, usage({ nonCachedInputTokens: 1_000 }))).toBe(0)
    expect(
      calculateCost(
        { text: { input: { unit: "character", price: 1 }, output: { price: 1 } } },
        usage({ nonCachedInputTokens: 1_000 }),
      ),
    ).toBe(0)
  })
})
