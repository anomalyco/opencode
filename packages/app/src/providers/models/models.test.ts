import { expect, test } from "bun:test"
import { latestModels, uniqueModels } from "./models"

const model = (provider: string, id: string, release_date: string, family?: string) => ({
  id,
  family,
  release_date,
  provider: { id: provider },
})

test("keeps the newest model of each provider and family", () => {
  expect(
    latestModels([
      model("a", "old", "2026-01-01", "f"),
      model("a", "new", "2026-03-01", "f"),
      model("a", "other", "2026-02-01", "g"),
      model("b", "b-only", "2026-01-01", "f"),
    ]),
  ).toEqual([
    { providerID: "a", modelID: "new" },
    { providerID: "a", modelID: "other" },
    { providerID: "b", modelID: "b-only" },
  ])
})

test("a tie in release date keeps the first model listed", () => {
  expect(
    latestModels([model("a", "first", "2026-01-01", "f"), model("a", "second", "2026-01-01", "f")]),
  ).toEqual([{ providerID: "a", modelID: "first" }])
})

test("groups free models apart from their paid twin", () => {
  const free = { ...model("opencode", "x-free", "2026-01-01", "x"), cost: { input: 0 } }
  const paid = { ...model("opencode", "x", "2026-01-01", "x"), cost: { input: 1 } }

  expect(latestModels([free, paid])).toEqual([
    { providerID: "opencode", modelID: "x-free" },
    { providerID: "opencode", modelID: "x" },
  ])
})

test("uniqueModels keeps the first of each model in order", () => {
  expect(
    uniqueModels([
      { providerID: "a", modelID: "1" },
      { providerID: "b", modelID: "1" },
      { providerID: "a", modelID: "1" },
      { providerID: "a", modelID: "2" },
    ]),
  ).toEqual([
    { providerID: "a", modelID: "1" },
    { providerID: "b", modelID: "1" },
    { providerID: "a", modelID: "2" },
  ])
})
