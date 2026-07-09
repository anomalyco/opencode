import { expect, test } from "bun:test"
import { nextVariantInCycle, parseModel, recentModels } from "../../src/context/local"

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

test("cycles non-default variants when a default variant exists", () => {
  const variants = ["high", "max", "default", "none"]

  expect(nextVariantInCycle(variants, "default")).toBe("high")
  expect(nextVariantInCycle(variants, "high")).toBe("max")
  expect(nextVariantInCycle(variants, "max")).toBe("none")
  expect(nextVariantInCycle(variants, "none")).toBeUndefined()
})

test("does not cycle when only the default variant exists", () => {
  expect(nextVariantInCycle(["default"], "default")).toBeNull()
})
