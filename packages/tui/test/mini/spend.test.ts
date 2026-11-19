import { describe, expect, test } from "bun:test"
import { sessionSpend } from "../../src/mini/spend"
import type { CostMessage, CostModel, CostSession } from "../../src/util/session"

const ref = { providerID: "provider", id: "model" }
const pricing: CostModel = {
  ...ref,
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
}
const tiered: CostModel = {
  ...pricing,
  cost: [
    ...pricing.cost,
    { tier: { type: "context", size: 200_000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } },
  ],
}

const tokens = (millions: number) => ({
  input: millions * 1_000_000,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

const session = (usage: ReturnType<typeof tokens>, cost = 0): CostSession => ({
  id: "session",
  model: ref,
  tokens: usage,
  cost,
  time: { created: 0 },
})

const step = (usage: ReturnType<typeof tokens>): CostMessage => ({
  type: "assistant",
  tokens: usage,
  time: { created: 1 },
})

describe("mini spend", () => {
  test("keeps the per-step cost when the experiment is off", () => {
    expect(sessionSpend({ enabled: false, session: session(tokens(1)), models: [pricing], messages: [] })).toEqual({})
  })

  test("omits the estimate when the provider reports a cost", () => {
    expect(sessionSpend({ enabled: true, session: session(tokens(1), 1.25), models: [pricing], messages: [] })).toEqual({})
  })

  test("estimates a zero-cost session from catalog prices", () => {
    expect(sessionSpend({ enabled: true, session: session(tokens(1)), models: [pricing], messages: [] })).toEqual({
      estimate: 3,
    })
  })

  test("adds per-call tier surcharges for observed steps", () => {
    const spend = sessionSpend({
      enabled: true,
      session: session(tokens(0.3)),
      models: [tiered],
      messages: [step(tokens(0.3))],
    })
    expect(spend.estimate).toBeCloseTo(1.8)
  })

  test("omits the line when the model has no catalog pricing", () => {
    expect(
      sessionSpend({
        enabled: true,
        session: session(tokens(1)),
        models: [{ ...pricing, providerID: "other" }],
        messages: [],
      }),
    ).toEqual({})
  })
})
