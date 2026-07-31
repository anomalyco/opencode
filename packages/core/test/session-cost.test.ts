import { expect, test } from "bun:test"
import { sumSessionCosts } from "@opencode-ai/core/session"

test("sums session costs and treats missing costs as zero", () => {
  expect(sumSessionCosts([{ cost: 0.05 }, {}, { cost: 10.29 }])).toBeCloseTo(10.34)
})
