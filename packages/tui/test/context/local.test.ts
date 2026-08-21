import { expect, test } from "bun:test"
import { parseModel, recentModels, resolveAgentModelSelection } from "../../src/context/local"

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

test("uses the configured model when switching agents", () => {
  expect(
    resolveAgentModelSelection({
      agent: { id: "build", model: { providerID: "provider", id: "build-model", variant: "max" } },
      session: {
        agent: "plan",
        model: { providerID: "provider", id: "plan-model", variant: "high" },
      },
      available: () => true,
    }),
  ).toEqual({ providerID: "provider", modelID: "build-model", variant: "max" })
})

test("keeps a manual model selection for each session agent", () => {
  expect(
    resolveAgentModelSelection({
      selected: { providerID: "provider", modelID: "manual-model", variant: "high" },
      agent: { id: "build", model: { providerID: "provider", id: "build-model", variant: "max" } },
      session: { agent: "plan", model: { providerID: "provider", id: "plan-model" } },
      available: () => true,
    }),
  ).toEqual({ providerID: "provider", modelID: "manual-model", variant: "high" })
})

test("keeps the durable model while the active agent is unchanged", () => {
  expect(
    resolveAgentModelSelection({
      agent: { id: "plan", model: { providerID: "provider", id: "configured-model", variant: "max" } },
      session: { agent: "plan", model: { providerID: "provider", id: "manual-model", variant: "high" } },
      available: () => true,
    }),
  ).toEqual({ providerID: "provider", modelID: "manual-model", variant: "high" })
})

test("keeps the session model when the next agent has no configured model", () => {
  expect(
    resolveAgentModelSelection({
      agent: { id: "review" },
      session: { agent: "plan", model: { providerID: "provider", id: "plan-model", variant: "high" } },
      available: () => true,
    }),
  ).toEqual({ providerID: "provider", modelID: "plan-model", variant: "high" })
})
