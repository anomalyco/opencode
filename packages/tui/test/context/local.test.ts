import { expect, test } from "bun:test"
import { parseModel, recentModels, withDefaultModelFallback } from "../../src/context/local"

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

test("session selection wins over the default model", () => {
  const selection = { providerID: "openai", modelID: "gpt", variant: "high" }
  expect(
    withDefaultModelFallback({
      selection,
      defaultModel: { providerID: "opencode", modelID: "fable" },
      isValid: () => true,
      variantPreference: () => undefined,
    }),
  ).toBe(selection)
})

test("sessions without a stored model fall back to the server default", () => {
  expect(
    withDefaultModelFallback({
      selection: undefined,
      defaultModel: { providerID: "opencode", modelID: "fable" },
      isValid: () => true,
      variantPreference: (model) => (model.modelID === "fable" ? "max" : undefined),
    }),
  ).toEqual({ providerID: "opencode", modelID: "fable", variant: "max" })
})

test("no provider is reported only without a usable default", () => {
  expect(
    withDefaultModelFallback({
      selection: undefined,
      defaultModel: undefined,
      isValid: () => true,
      variantPreference: () => undefined,
    }),
  ).toBeUndefined()
  expect(
    withDefaultModelFallback({
      selection: undefined,
      defaultModel: { providerID: "gone", modelID: "model" },
      isValid: () => false,
      variantPreference: () => undefined,
    }),
  ).toBeUndefined()
})
