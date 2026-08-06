import { expect, test } from "bun:test"
import { firstValidModel, parseModel, recentModels } from "../../src/context/local"

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

test("falls back when another location's selected model is unavailable", () => {
  const fable = { providerID: "opencode", modelID: "claude-fable-5" }
  const gpt = { providerID: "openai", modelID: "gpt-5.6-sol" }
  const lifeHubModels = [{ providerID: "openai", id: "gpt-5.6-sol" }]

  expect(firstValidModel(lifeHubModels, [fable, gpt])).toEqual(gpt)
})
