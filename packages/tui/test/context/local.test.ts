import { expect, test } from "bun:test"
import { parseModel, recentModels, shouldSeedSessionModel } from "../../src/context/local"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
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

test("seeds the model from session state when the agent has no override", () => {
  expect(shouldSeedSessionModel(undefined)).toBe(true)
})

test("keeps a picked model instead of reseeding it from session state", () => {
  expect(shouldSeedSessionModel({ providerID: "provider", modelID: "model" })).toBe(false)
})
