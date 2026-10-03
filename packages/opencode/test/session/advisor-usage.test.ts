import { expect, test } from "bun:test"
import { AdvisorUsage } from "../../src/session/advisor-usage"
import { catalogAdvisor, model } from "../fixture/advisor"

const iteration = {
  type: "advisor_message",
  model,
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 3000,
  cache_creation_input_tokens: 500,
}
const metadata = {
  anthropic: { usage: { iterations: [iteration, { type: "message", input_tokens: 100, output_tokens: 10 }] } },
}

test("prices raw advisor components without subtracting caches or counting executor usage", () => {
  const usage = AdvisorUsage.calculate(metadata, model, { [model]: catalogAdvisor })
  expect(usage).toMatchObject({
    complete: true,
    cost: 0.014625,
    iterations: [{ model, input: 1000, output: 200, cacheRead: 3000, cacheWrite: 500, cost: 0.014625 }],
  })
})

test("marks missing advisor prices incomplete while keeping known usage", () => {
  const usage = AdvisorUsage.calculate(metadata, model, {})
  expect(usage).toMatchObject({ complete: false, cost: 0, iterations: [{ model, input: 1000, output: 200 }] })
  expect(usage?.iterations[0].cost).toBeUndefined()
})

test("does not create advisor usage when no advisor iteration was reported", () => {
  expect(AdvisorUsage.calculate(undefined, model, {})).toBeUndefined()
  expect(
    AdvisorUsage.calculate(
      { anthropic: { usage: { iterations: [{ type: "message", input_tokens: 10, output_tokens: 1 }] } } },
      model,
      {},
    ),
  ).toBeUndefined()
})

test("uses the reported advisor model and applies its context tier", () => {
  const tiered = {
    ...catalogAdvisor,
    cost: {
      ...catalogAdvisor.cost,
      tiers: [
        { tier: { type: "context" as const, size: 100 }, input: 10, output: 50, cache: { read: 1, write: 12.5 } },
      ],
    },
  }
  expect(AdvisorUsage.calculate(metadata, "not-the-reported-model", { [model]: tiered })?.cost).toBeCloseTo(0.02925, 12)
})

test("does not price invalid token counts or unsupported cache TTL breakdowns", () => {
  for (const value of [
    { ...iteration, input_tokens: -1 },
    { ...iteration, cache_creation: { ephemeral_1h_input_tokens: 500 } },
  ]) {
    const usage = AdvisorUsage.calculate({ anthropic: { usage: { iterations: [value] } } }, model, {
      [model]: catalogAdvisor,
    })
    expect(usage?.complete).toBe(false)
    expect(usage?.iterations[0].cost).toBeUndefined()
  }
})
