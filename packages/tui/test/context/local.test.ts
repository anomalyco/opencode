import { expect, test } from "bun:test"
import { contextSelection, parseModel, recentModels } from "../../src/context/local"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("context selection preserves reasoning and defaults older persisted variants", () => {
  expect(contextSelection()).toEqual({ effort: "default", tier: "default" })
  expect(contextSelection("high")).toEqual({ effort: "high", tier: "default" })
  expect(contextSelection("high@long")).toEqual({ effort: "high", tier: "long" })
  expect(contextSelection("medium@default")).toEqual({ effort: "medium", tier: "default" })
  expect(contextSelection("default@long")).toEqual({ effort: "default", tier: "long" })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})
