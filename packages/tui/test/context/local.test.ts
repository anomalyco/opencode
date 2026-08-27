import { expect, test } from "bun:test"
import { parseModel, recentModels, resolvePrimaryAgent, visiblePrimaryAgents } from "../../src/context/local"

const agents = [
  { name: "visible", mode: "primary", hidden: false },
  { name: "hidden", mode: "primary", hidden: true },
  { name: "hidden-subagent", mode: "subagent", hidden: true },
] as const

test("resolves hidden primary agents without including them in visible agents", () => {
  expect(visiblePrimaryAgents([...agents]).map((agent) => agent.name)).toEqual(["visible"])
  expect(resolvePrimaryAgent([...agents], "hidden")?.name).toBe("hidden")
})

test("does not resolve hidden subagents as primary agents", () => {
  expect(resolvePrimaryAgent([...agents], "hidden-subagent")).toBeUndefined()
})

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
