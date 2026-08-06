import { expect, test } from "bun:test"
import { parseModel, recentModels, sessionModelSelection } from "../../src/context/local"

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

test("keeps model drafts scoped to their session", () => {
  const fable = { providerID: "opencode", modelID: "claude-fable-5" }
  const gpt = { providerID: "openai", modelID: "gpt-5.6-sol" }
  const drafts = { "session:opencode": fable }

  expect(sessionModelSelection("opencode", drafts, gpt, gpt)).toEqual(fable)
  expect(sessionModelSelection("life-hub", drafts, gpt, fable)).toEqual(gpt)
  expect(sessionModelSelection("life-hub", drafts, fable, gpt)).toEqual(fable)
  expect(sessionModelSelection("life-hub", drafts, undefined, gpt)).toBeUndefined()
  expect(sessionModelSelection(undefined, drafts, fable, gpt)).toEqual(gpt)
})
