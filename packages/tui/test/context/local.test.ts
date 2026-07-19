import { expect, test } from "bun:test"
import { parseModel, recentModels, selectModel } from "../../src/context/local"

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

test("keeps model selection per agent by default", () => {
  const selected = { providerID: "provider", modelID: "selected" }

  expect(
    selectModel(
      {
        plan: { providerID: "provider", modelID: "plan" },
        build: { providerID: "provider", modelID: "build" },
      },
      "plan",
      selected,
      false,
    ),
  ).toEqual({
    plan: selected,
    build: { providerID: "provider", modelID: "build" },
  })
})

test("shares model selection between plan and build when enabled", () => {
  const custom = { providerID: "provider", modelID: "custom" }
  const selected = { providerID: "provider", modelID: "selected" }

  expect(
    selectModel(
      {
        plan: { providerID: "provider", modelID: "plan" },
        build: { providerID: "provider", modelID: "build" },
        custom,
      },
      "build",
      selected,
      true,
    ),
  ).toEqual({
    plan: selected,
    build: selected,
    custom,
  })
})

test("keeps custom agent model selection independent", () => {
  const selected = { providerID: "provider", modelID: "selected" }

  expect(
    selectModel(
      {
        plan: { providerID: "provider", modelID: "plan" },
        build: { providerID: "provider", modelID: "build" },
        custom: { providerID: "provider", modelID: "custom" },
      },
      "custom",
      selected,
      true,
    ),
  ).toEqual({
    plan: { providerID: "provider", modelID: "plan" },
    build: { providerID: "provider", modelID: "build" },
    custom: selected,
  })
})
