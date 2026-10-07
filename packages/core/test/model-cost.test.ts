import { describe, expect, test } from "bun:test"
import { ModelCost } from "@opencode-ai/core/model-cost"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

const make = (cost: ModelV2.Info["cost"]) =>
  ModelV2.Info.make({
    id: ModelV2.ID.make("m" as ModelV2.ID),
    providerID: ProviderV2.ID.make("p" as ProviderV2.ID),
    name: "m",
    api: { id: ModelV2.ID.make("m" as ModelV2.ID), type: "aisdk", package: "@ai-sdk/openai" },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: 0 },
    cost,
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

describe("ModelCost.isFree", () => {
  test("unknown pricing (no cost entry) counts as paid", () => {
    expect(ModelCost.isFree(make([]))).toBe(false)
  })

  test("a tier pricing every meter at zero is free", () => {
    expect(ModelCost.isFree(make([{ input: 0, output: 0, cache: { read: 0, write: 0 } }]))).toBe(true)
  })

  test("any nonzero meter is paid", () => {
    expect(ModelCost.isFree(make([{ input: 1, output: 0, cache: { read: 0, write: 0 } }]))).toBe(false)
    expect(ModelCost.isFree(make([{ input: 0, output: 2, cache: { read: 0, write: 0 } }]))).toBe(false)
    expect(ModelCost.isFree(make([{ input: 0, output: 0, cache: { read: 1, write: 0 } }]))).toBe(false)
    expect(ModelCost.isFree(make([{ input: 0, output: 0, cache: { read: 0, write: 1 } }]))).toBe(false)
  })

  test("only the first cost tier is considered", () => {
    expect(
      ModelCost.isFree(
        make([
          { input: 0, output: 0, cache: { read: 0, write: 0 } },
          { input: 5, output: 5, cache: { read: 5, write: 5 } },
        ]),
      ),
    ).toBe(true)
  })
})
