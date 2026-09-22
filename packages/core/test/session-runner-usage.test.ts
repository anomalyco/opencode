import { describe, expect, it } from "bun:test"
import { Model } from "@opencode-ai/schema/model"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionRunnerUsage } from "@opencode-ai/core/session/runner/usage"

const info = (cost: Model.Cost[]): ModelV2.Info => ({
  ...ModelV2.Info.empty(ProviderV2.ID.make("provider"), ModelV2.ID.make("model")),
  cost,
})

const tokens = (input: number, output: number, reasoning = 0, cache = { read: 0, write: 0 }) => ({
  input,
  output,
  reasoning,
  cache,
})

describe("SessionRunnerUsage", () => {
  it("prices from the base rates with reasoning charged at the output rate", () => {
    const model = info([
      { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
    ])
    expect(
      SessionRunnerUsage.cost(model, tokens(1_000_000, 100_000, 50_000, { read: 200_000, write: 0 })),
    ).toBe(1_000_000 * 3 / 1_000_000 + 150_000 * 15 / 1_000_000 + 200_000 * 0.3 / 1_000_000)
  })

  it("escalates to the largest context tier below the context size", () => {
    const model = info([
      { input: 3, output: 15, cache: { read: 0, write: 0 } },
      { tier: { type: "context", size: 200_000 }, input: 6, output: 30, cache: { read: 0, write: 0 } },
      { tier: { type: "context", size: 1_000_000 }, input: 6, output: 45, cache: { read: 0, write: 0 } },
    ])
    expect(SessionRunnerUsage.cost(model, tokens(300_000, 0))).toBe(300_000 * 6 / 1_000_000)
    expect(SessionRunnerUsage.cost(model, tokens(100_000, 0))).toBe(100_000 * 3 / 1_000_000)
  })

  it("returns zero when the model has no rates", () => {
    expect(SessionRunnerUsage.cost(info([]), tokens(1_000, 1_000))).toBe(0)
  })

  it("prefers the copilot totalNanoAiu provider override", () => {
    const model = info([{ input: 3, output: 15, cache: { read: 0, write: 0 } }])
    expect(
      SessionRunnerUsage.cost(model, tokens(1_000, 0), { copilot: { totalNanoAiu: 12_345 } }),
    ).toBeCloseTo(12_345 / 100_000_000_000, 12)
  })

  it("clamps non-finite and negative results to zero", () => {
    expect(SessionRunnerUsage.cost(info([{ input: -5, output: 15, cache: { read: 0, write: 0 } }]), tokens(100, 0))).toBe(0)
  })
})